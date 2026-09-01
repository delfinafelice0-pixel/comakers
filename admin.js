import { supabase, aprobarVenta, enviarMailVenta, baseDe } from "../lib/aprobar.js";
import { bancoActual, guardarBanco } from "../lib/ajustes.js";
import { enviarMailPendiente } from "../lib/pendiente.js";

/**
 * Panel de administración.
 * Autenticación simple por token en el header. Es suficiente para este uso,
 * pero el token tiene que ser largo y no compartirse por canales abiertos.
 *
 * GET  /api/admin?accion=exportar   todas las ventas, con todos los campos
 * GET  /api/admin?accion=pendientes
 * POST /api/admin  { accion:"aprobar"|"rechazar", id:"uuid" }
 * POST /api/admin  { accion:"banco", banco:{ alias, cbu, titular, cuit, banco } }
 * POST /api/admin  { accion:"mail",  id:"uuid" }   manda o reenvía la confirmación
 * POST /api/admin  { accion:"anular", id:"uuid" }   saca una venta aprobada de la cuenta
 * POST /api/admin  { accion:"recuperar", id:"uuid" } devuelve una descartada a su lugar
 */
export default async function handler(req, res) {
  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    // ---- exportación ----
    // Devuelve las filas completas para armar el CSV en el navegador.
    // Acepta los mismos filtros que el listado, más `estado` para elegir
    // qué incluir (por defecto, solo las aprobadas).
    if (req.method === "GET" && req.query?.accion === "exportar") {
      const estado = req.query?.estado || "aprobado";
      const metodo = req.query?.metodo;
      const desde  = req.query?.desde;
      const hasta  = req.query?.hasta;

      let q = supabase.from("ventas").select("*");
      if (estado !== "todos") q = q.eq("estado", estado);
      if (metodo && metodo !== "todos") q = q.eq("metodo", metodo);
      if (desde) q = q.gte("creado_at", `${desde}T00:00:00-03:00`);
      if (hasta) q = q.lte("creado_at", `${hasta}T23:59:59-03:00`);

      const { data: filas, error } = await q
        .order("creado_at", { ascending: false })
        .limit(5000);

      if (error) throw error;
      return res.status(200).json({ filas: filas ?? [] });
    }

    // ---- objetivos / campaña ----
    // Datos para la solapa "Objetivos": recaudado real (todas las aprobadas)
    // más la config editable (meta, fecha, inversión, inicio) guardada en
    // `ajustes`. El cálculo de CPA/ROAS/proyección se hace en el navegador.
    if (req.method === "GET" && req.query?.accion === "objetivos") {
      const { data: aprob } = await supabase
        .from("ventas")
        .select("monto, cantidad, creado_at, pagado_at")
        .eq("estado", "aprobado")
        .limit(5000);

      const filas = aprob ?? [];
      const recaudado = filas.reduce((a, v) => a + Number(v.monto || 0), 0);
      const ventas = filas.length;
      const chances = filas.reduce((a, v) => a + Number(v.cantidad || 0), 0);
      let primera = null;
      for (const v of filas) {
        if (v.creado_at && (!primera || v.creado_at < primera)) primera = v.creado_at;
      }

      const { data: cfgRow } = await supabase
        .from("ajustes").select("valor").eq("clave", "campania").maybeSingle();

      return res.status(200).json({
        recaudado,
        ventas,
        chances,
        primeraVentaAt: primera,
        config: cfgRow?.valor || {},
        // detalle liviano para calcular "hoy" y las conclusiones en el navegador
        detalle: filas,
      });
    }

    // ---- listado ----
    if (req.method === "GET") {
      const { data: filas } = await supabase
        .from("ventas")
        .select("id, codigo, creado_at, nombre, email, telefono, dni, domicilio, edad, cantidad, monto, comprobante_path, comprobante_at")
        .eq("estado", "transferencia")
        .order("creado_at", { ascending: false })
        .limit(100);

      // Los comprobantes viven en un depósito privado: generamos un enlace
      // temporal para cada uno, válido por una hora.
      const pendientes = await Promise.all(
        (filas ?? []).map(async (v) => {
          if (!v.comprobante_path) return v;
          const { data } = await supabase.storage
            .from("comprobantes")
            .createSignedUrl(v.comprobante_path, 3600);
          return { ...v, comprobante_url: data?.signedUrl ?? null };
        })
      );

      // Filtros opcionales para el listado de aprobadas
      const metodo = req.query?.metodo;          // mercadopago | transferencia
      const desde  = req.query?.desde;           // AAAA-MM-DD
      const hasta  = req.query?.hasta;           // AAAA-MM-DD

      let consulta = supabase
        .from("ventas")
        .select("id, codigo, nombre, email, telefono, dni, domicilio, edad, cantidad, monto, metodo, pagado_at, numeros_iphone, numeros_fiesta, mail_enviado, mail_error")
        .eq("estado", "aprobado");

      if (metodo && metodo !== "todos") consulta = consulta.eq("metodo", metodo);
      if (desde) consulta = consulta.gte("pagado_at", `${desde}T00:00:00-03:00`);
      if (hasta) consulta = consulta.lte("pagado_at", `${hasta}T23:59:59-03:00`);

      const { data: recientes } = await consulta
        .order("pagado_at", { ascending: false })
        .limit(500);

      // Totales sobre TODAS las aprobadas que cumplen los filtros (no solo las
      // que se muestran en pantalla). Antes se sumaban solo las que entraban en
      // el listado, así que con muchas ventas el "Recaudado" quedaba corto.
      // Mismo límite que la exportación, para que panel y planilla coincidan.
      let totalesQ = supabase
        .from("ventas")
        .select("monto, cantidad")
        .eq("estado", "aprobado");
      if (metodo && metodo !== "todos") totalesQ = totalesQ.eq("metodo", metodo);
      if (desde) totalesQ = totalesQ.gte("pagado_at", `${desde}T00:00:00-03:00`);
      if (hasta) totalesQ = totalesQ.lte("pagado_at", `${hasta}T23:59:59-03:00`);
      const { data: todasAprob } = await totalesQ.limit(5000);

      const resumen = {
        cantidad: (todasAprob ?? []).length,
        monto: (todasAprob ?? []).reduce((a, v) => a + Number(v.monto || 0), 0),
        chances: (todasAprob ?? []).reduce((a, v) => a + Number(v.cantidad || 0), 0),
      };

      // Descartadas: las rechazadas antes de aprobar y las anuladas después.
      // Se listan aparte para poder recuperarlas si alguien se equivocó.
      const { data: descartados } = await supabase
        .from("ventas")
        .select("id, codigo, nombre, email, cantidad, monto, metodo, estado, creado_at, pagado_at, payment_id, numeros_iphone, numeros_fiesta, comprobante_at")
        .in("estado", ["rechazado", "anulado"])
        .order("creado_at", { ascending: false })
        .limit(100);

      const { data: contadores } = await supabase.from("contadores").select("*");

      // Datos bancarios vigentes. `fresco = true`: en el panel siempre
      // queremos ver lo último guardado, sin pasar por el cache.
      const banco = await bancoActual(true);

      return res.status(200).json({
        pendientes: pendientes ?? [],
        recientes: recientes ?? [],
        resumen,
        contadores: contadores ?? [],
        descartados: descartados ?? [],
        banco,
      });
    }

    // ---- acciones ----
    if (req.method === "POST") {
      const { accion, id } = req.body ?? {};

      // Guardar alias, CBU, titular y CUIT. No lleva id: es un ajuste global.
      if (accion === "banco") {
        const r = await guardarBanco(req.body?.banco);
        if (!r.ok) return res.status(400).json({ error: r.error });
        return res.status(200).json({ ok: true, banco: r.banco });
      }

      // Guardar la config de la campaña (meta, fecha, inversión, inicio).
      // No lleva id: es un ajuste global, como el banco.
      if (accion === "guardar-objetivos") {
        const c = req.body?.config || {};
        const num = (x) => Math.max(0, Number(String(x ?? "").replace(/[^\d]/g, "")) || 0);
        const limpio = {
          objetivo: num(c.objetivo),
          inversion: num(c.inversion),
          ventasPauta: num(c.ventasPauta),
          presupuestoTotal: num(c.presupuestoTotal),
          fecha: String(c.fecha ?? "").slice(0, 10),
          inicio: String(c.inicio ?? "").slice(0, 10),
          plan: Array.isArray(c.plan)
            ? c.plan.slice(0, 24)
                .map((s) => ({ desde: String(s?.desde ?? "").slice(0, 10), diario: num(s?.diario) }))
                .filter((s) => s.desde || s.diario)
            : [],
        };
        await supabase.from("ajustes").upsert(
          { clave: "campania", valor: limpio, actualizado_at: new Date().toISOString() },
          { onConflict: "clave" }
        );
        return res.status(200).json({ ok: true, config: limpio });
      }

      if (!id) return res.status(400).json({ error: "Falta el id" });

      // Corregir el mail de un cliente que lo cargó mal (típico: le pega el
      // teléfono o un "ok" al final). Solo cambia el email; nada más.
      if (accion === "editar-email") {
        const nuevo = String(req.body?.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nuevo)) {
          return res.status(400).json({ error: "Revisá el correo, no parece válido" });
        }
        const { data: venta } = await supabase
          .from("ventas").select("id").eq("id", id).single();
        if (!venta) return res.status(404).json({ error: "No encontramos esa venta" });
        await supabase.from("ventas").update({ email: nuevo }).eq("id", id);
        return res.status(200).json({ ok: true, email: nuevo });
      }

      if (accion === "rechazar") {
        await supabase.from("ventas").update({ estado: "rechazado" }).eq("id", id);
        return res.status(200).json({ ok: true });
      }

      // Manda la confirmación de una venta ya aprobada. No toca números ni
      // estado: solo vuelve a mandar el mail que correspondía.
      if (accion === "mail") {
        const { data: venta } = await supabase
          .from("ventas")
          .select("*")
          .eq("id", id)
          .single();

        if (!venta) return res.status(404).json({ error: "No encontramos esa venta" });
        if (!venta.payment_id) {
          return res.status(409).json({
            error: "Esa venta no está aprobada. No corresponde mandar la confirmación.",
          });
        }

        const r = await enviarMailVenta(venta, baseDe(req));
        if (!r.ok) return res.status(502).json({ error: r.error });
        return res.status(200).json({ ok: true, enviado_a: venta.email });
      }

      /* Manda el recordatorio de comprobante pendiente a UNA transferencia
         concreta, desde el botón del panel. Solo aplica a transferencias que
         siguen abiertas y sin comprobante. Deja registrado el envío en
         recordatorio_at / recordatorios, igual que el cron. */
      if (accion === "recordatorio") {
        const { data: venta } = await supabase
          .from("ventas")
          .select("*")
          .eq("id", id)
          .single();

        if (!venta) return res.status(404).json({ error: "No encontramos esa venta" });
        if (venta.metodo !== "transferencia" || venta.payment_id) {
          return res.status(409).json({ error: "El recordatorio es solo para transferencias sin pago acreditado" });
        }
        if (venta.comprobante_at) {
          return res.status(409).json({ error: "Esta compra ya tiene el comprobante cargado" });
        }

        // Si estaba descartada, la reactivamos: vuelve a "Esperando confirmación"
        // así el enlace del mail ("Cargar mi comprobante") le funciona.
        if (venta.estado === "rechazado") {
          await supabase.from("ventas").update({ estado: "transferencia" }).eq("id", id);
          venta.estado = "transferencia";
        }
        if (venta.estado !== "transferencia") {
          return res.status(409).json({ error: "Esta compra ya fue procesada" });
        }

        const r = await enviarMailPendiente(venta, baseDe(req));
        if (!r.ok) return res.status(502).json({ error: r.error });

        await supabase
          .from("ventas")
          .update({
            recordatorio_at: new Date().toISOString(),
            recordatorios: (venta.recordatorios || 0) + 1,
          })
          .eq("id", id);

        return res.status(200).json({ ok: true, enviado_a: venta.email });
      }

      /* Anular una venta aprobada. No se borra la fila ni se liberan los
         números: el comprador ya los recibió por mail y tienen que quedar
         registrados. Sale de la lista de aprobadas y de los totales, y
         queda en Descartadas por si hubo un error. */
      if (accion === "anular") {
        const { data: venta } = await supabase
          .from("ventas").select("estado").eq("id", id).single();
        if (!venta) return res.status(404).json({ error: "No encontramos esa venta" });
        if (venta.estado !== "aprobado") {
          return res.status(409).json({ error: "Solo se pueden anular ventas aprobadas" });
        }
        await supabase.from("ventas").update({ estado: "anulado" }).eq("id", id);
        return res.status(200).json({ ok: true });
      }

      /* Devuelve una descartada a donde estaba: si tiene pago registrado
         vuelve a aprobada, y si no, a la cola de pendientes. */
      if (accion === "recuperar") {
        const { data: venta } = await supabase
          .from("ventas").select("estado, payment_id").eq("id", id).single();
        if (!venta) return res.status(404).json({ error: "No encontramos esa venta" });
        if (!["rechazado", "anulado"].includes(venta.estado)) {
          return res.status(409).json({ error: "Esa venta no está descartada" });
        }
        const destino = venta.payment_id ? "aprobado" : "transferencia";
        await supabase.from("ventas").update({ estado: destino }).eq("id", id);
        return res.status(200).json({ ok: true, estado: destino });
      }

      if (accion === "aprobar") {
        const referencia = `transf-${String(id).slice(0, 8)}`;
        const r = await aprobarVenta(id, referencia, baseDe(req));
        if (!r.ok) return res.status(409).json({ error: r.motivo });
        return res.status(200).json({
          ok: true,
          numerosIphone: r.venta.numeros_iphone,
          numerosFiesta: r.venta.numeros_fiesta,
        });
      }

      return res.status(400).json({ error: "Acción desconocida" });
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    console.error("admin:", e);
    return res.status(500).json({ error: "Error del servidor" });
  }
}
