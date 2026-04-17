// ENDPOINT TEMPORAL DE DIAGNÓSTICO
// Colócalo en: functions/api/dashboard/debug.js
// Úsalo UNA VEZ y luego bórralo

export async function onRequestGet(context) {
  const { env } = context;
  
  // Ver los primeros 5 pedidos con su fecha exacta y la conversión
  const { results } = await env.elegance_db.prepare(`
    SELECT 
      id_pedido,
      fecha,
      created_at,
      total,
      substr(fecha,7,4)||'-'||substr(fecha,1,2)||'-'||substr(fecha,4,2) AS fecha_iso,
      length(fecha) AS largo_fecha
    FROM pedidos 
    ORDER BY created_at DESC 
    LIMIT 5
  `).all();
  
  return Response.json({ success: true, pedidos: results });
}