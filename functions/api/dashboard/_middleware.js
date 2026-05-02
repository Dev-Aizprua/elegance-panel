// ============================================================
// functions/api/dashboard/_middleware.js
// PORTERO CENTRAL — intercepta TODAS las llamadas a /api/dashboard/
// Solo permite acceso si el token es válido
// ============================================================

export async function onRequest(context) {
  const { request, env, next } = context;

  // OPTIONS (preflight CORS) — siempre permitir
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Leer token del header Authorization: Bearer <token>
  const authHeader = request.headers.get('Authorization') || '';
  const token      = authHeader.replace('Bearer ', '').trim();

  // Token válido guardado como variable de entorno en Cloudflare
  const tokenValido = env.ACCESS_TOKEN || '';

  if (!tokenValido) {
    // Si no hay variable configurada, bloquear con mensaje claro
    return Response.json(
      { success: false, error: 'Panel no configurado — falta ACCESS_TOKEN en Variables de Entorno' },
      { status: 503 }
    );
  }

  if (token !== tokenValido) {
    return Response.json(
      { success: false, error: 'Acceso no autorizado' },
      { status: 401 }
    );
  }

  // Token válido — continuar al handler de la ruta
  return next();
}