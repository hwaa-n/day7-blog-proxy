const BLOG_ID = "paintday7";
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;
const MAX_ITEMS = 8;

export default async function handler(req, res) {
  try {
    const rssRes = await fetch(RSS_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; blog-sync-bot/1.0)" },
    });
    if (!rssRes.ok) throw new Error(`RSS 요청 실패: ${rssRes.status}`);
    const xml = await rssRes.text();

    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, MAX_ITEMS)
      .map((m) => m[1]);

    const posts = await Promise.all(
      itemBlocks.map(async (block) => {
        const title = decodeEntities(pickTag(block, "title"));
        const link = decodeEntities(pickTag(block, "link"));
        const pubDate = pickTag(block, "pubDate");
        const description = pickTag(block, "description");
        const categories = [...block.matchAll(/<category>([\s\S]*?)<\/category>/g)].map(
          (m) => decodeEntities(m[1].trim())
        );

        let thumbnail = firstImgSrc(description);
        if (!thumbnail && link) {
          thumbnail = await fetchOgImage(link);
        }

        return {
          title,
          link,
          pubDate,
          year: pubDate ? new Date(pubDate).getFullYear() : null,
          tags: categories,
          thumbnail: thumbnail || null,
        };
      })
    );

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ blogId: BLOG_ID, posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function pickTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return "";
  return m[1].replace("<![CDATA[", "").replace("]]>", "").trim();
}

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function firstImgSrc(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

async function fetchOgImage(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; blog-sync-bot/1.0)" },
    });
    const html = await r.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
