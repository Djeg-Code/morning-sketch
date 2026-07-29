// ---------------------------------------------------------------------------
// /api/data  —  Fonction serverless Vercel
//
// Lit ton channel are.na PRIVÉ côté serveur (API v3), avec ton jeton caché,
// et renvoie la liste des images à l'app. Le jeton ne touche jamais le navigateur.
//
// Variables d'environnement (Vercel → Settings → Environment Variables) :
//   • ARENA_TOKEN   → ton Personal Access Token are.na
//   • CHANNEL_SLUG  → paintings_references
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  const token = process.env.ARENA_TOKEN;
  const channel = process.env.CHANNEL_SLUG || "paintings_references";

  res.setHeader("Cache-Control", "no-store");

  if (!token) {
    res.status(500).json({ error: "ARENA_TOKEN manquant dans les variables Vercel." });
    return;
  }

  try {
    const images = [];
    let page = 1;
    const per = 100;
    let guard = 0;
    let loggedSample = false;

    while (guard++ < 30) {
      const url =
        "https://api.are.na/v3/channels/" +
        encodeURIComponent(channel) +
        "/contents?per=" + per + "&page=" + page;

      const r = await fetch(url, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      });

      if (!r.ok) {
        res.status(r.status === 401 ? 401 : 502).json({ error: "are.na a répondu " + r.status });
        return;
      }

      const body = await r.json();
      const items = body.data || [];

      for (const b of items) {
        if (b && b.type === "Image") {
          // Voie 1 (étape 5) : log ponctuel d'un bloc image v3 brut pour vérifier
          // dans les logs Vercel si are.na fournit déjà une couleur. À retirer plus tard.
          if (!loggedSample) { console.log("are.na image block (brut):", JSON.stringify(b)); loggedSample = true; }
          const src = pickImageUrl(b.image);
          const color = pickColor(b);              // couleur are.na si présente (sinon null → extraction client)
          if (src) images.push(color ? { id: String(b.id), src, color } : { id: String(b.id), src });
        }
      }

      const meta = body.meta || {};
      if (!meta.has_more_pages) break;
      page++;
    }

    res.status(200).json({ count: images.length, images });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

// Voie 1 (étape 5) : cherche une couleur éventuellement fournie par are.na sur le bloc.
// Les blocs image v3 n'en exposent pas aujourd'hui ; code défensif / à confirmer via les logs.
function pickColor(b) {
  const img = (b && b.image) || {};
  const cands = [img.average_color, img.dominant_color, b && b.average_color, b && b.dominant_color];
  for (const c of cands) { if (typeof c === "string" && c.trim()) return c.trim(); }
  const arr = img.colors || (b && b.colors);
  if (Array.isArray(arr) && arr.length) {
    const c = arr[0];
    if (typeof c === "string") return c;
    if (c && typeof c.hex === "string") return c.hex;
  }
  return null;
}

// Extrait l'URL d'image la plus grande possible, quelle que soit la forme de l'objet v3.
function pickImageUrl(image) {
  if (!image) return null;
  const order = ["original", "hd", "large", "display", "regular", "medium", "small", "thumb", "thumbnail", "square"];
  for (const k of order) {
    const v = image[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
    if (v && typeof v === "object") {
      if (typeof v.url === "string" && v.url.startsWith("http")) return v.url;
      if (typeof v.src === "string" && v.src.startsWith("http")) return v.src;
    }
  }
  return firstUrl(image, 0);
}

function firstUrl(obj, depth) {
  if (depth > 4 || !obj) return null;
  if (typeof obj === "string") return obj.startsWith("http") ? obj : null;
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      if (/url|src/i.test(k) && typeof obj[k] === "string" && obj[k].startsWith("http")) return obj[k];
    }
    for (const k of Object.keys(obj)) {
      const u = firstUrl(obj[k], depth + 1);
      if (u) return u;
    }
  }
  return null;
}
