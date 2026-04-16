// functions/api/cloudinary.js
// Upload de imágenes a Cloudinary (unsigned preset)
// y consulta del contador de fotos por carpeta

export async function onRequestPost(context) {
  const { request } = context;

  try {
    const formData = await request.formData();
    const file     = formData.get('file');
    const carpeta  = formData.get('carpeta') || 'minegocio';

    if (!file) {
      return Response.json({ success: false, error: 'No se recibió imagen' }, { status: 400 });
    }

    // Validar tamaño (máx 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ success: false, error: 'La imagen supera 10MB' }, { status: 400 });
    }

    // Validar tipo
    const tiposPermitidos = ['image/jpeg','image/jpg','image/png','image/webp'];
    if (!tiposPermitidos.includes(file.type)) {
      return Response.json({ success: false, error: 'Formato no permitido. Usa JPG, PNG o WEBP' }, { status: 400 });
    }

    // Subir a Cloudinary con preset unsigned
    const CLOUD_NAME = 'doaqu6s6c';
    const PRESET     = 'tienda';

    const upload = new FormData();
    upload.append('file',          file);
    upload.append('upload_preset', PRESET);
    upload.append('folder',        carpeta);

    const res  = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: 'POST', body: upload }
    );

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ success: false, error: 'Cloudinary: ' + err }, { status: 500 });
    }

    const data = await res.json();

    return Response.json({
      success:    true,
      url:        data.secure_url,
      public_id:  data.public_id,
      width:      data.width,
      height:     data.height,
    });

  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

// GET → contar fotos en una carpeta
export async function onRequestGet(context) {
  const { request } = context;
  const url     = new URL(request.url);
  const carpeta = url.searchParams.get('carpeta') || 'minegocio';

  try {
    const CLOUD_NAME = 'doaqu6s6c';
    const API_KEY    = '978137972327483';
    // El secret se pone como variable de entorno en Cloudflare
    const API_SECRET = context.env.CLOUDINARY_SECRET || '';

    const auth    = btoa(`${API_KEY}:${API_SECRET}`);
    const res     = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image/upload?prefix=${carpeta}&max_results=1`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (!res.ok) {
      return Response.json({ success: true, total: 0, limite: 200 });
    }

    const data  = await res.json();
    const total = data.total_count || 0;

    return Response.json({ success: true, total, limite: 200 });

  } catch (err) {
    return Response.json({ success: true, total: 0, limite: 200 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}