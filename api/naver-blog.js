// Vercel Serverless Function
// 배포 경로: /api/naver-blog.js  ->  https://내프로젝트.vercel.app/api/naver-blog
//
// 하는 일:
// 1) 네이버 블로그 RSS를 서버에서 대신 읽어온다 (최신 5개만).
// 2) 각 글의 title / link / pubDate / thumbnail을 추출한다.
//    - 썸네일: RSS 본문 첫 이미지 -> 없으면 포스트 페이지의 og:image
// 3) 이미지 주소는 우리 서버의 /api/image-proxy 를 거치도록 감싸서 반환한다.
//    (네이버 이미지 서버가 다른 도메인에서의 직접 요청을 막는 경우가 있어서)
//
// 참고: 해시태그는 네이버 블로그가 자바스크립트로 나중에 그려주는 영역이라
// 서버가 원본 HTML만 받아오는 이 방식으로는 가져올 수 없어서 제외했다.

const BLOG_ID = "paintday7";
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;
const MAX_ITEMS = 5; // 최신 5개까지만 노출

export default async function handler(req, res) {
  try {
    const rssRes = await fetch(RSS_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; blog-sync-bot/1.0)" },
    });
    if (!rssRes.ok) throw new Error(`RSS 요청 실패: ${rssRes.status}`);
    const xml = await rssRes.text();

    // RSS는 최신순으로 내려오므로 앞에서부터 MAX_ITEMS개만 사용하면
    // 새 글이 생길 때마다 자동으로 가장 오래된 글이 빠지는 구조가 된다.
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, MAX_ITEMS)
      .map((m) => m[1]);

    const origin = `https://${req.headers.host}`;

    const posts = await Promise.all(
      itemBlocks.map(async (block) => {
        const title = decodeEntities(pickTag(block, "title"));
        const link = decodeEntities(pickTag(block, "link"));
        const pubDate = pickTag(block, "pubDate");
        const description = pickTag(block, "description");

        let thumbnail = firstImgSrc(description);
        if (!thumbnail && link) {
          thumbnail = await fetchOgImage(link);
        }

        const proxiedThumbnail = thumbnail
          ? `${origin}/api/image-proxy?url=${encodeURIComponent(thumbnail)}`
          : null;

        return {
          title,
          link,
          pubDate,
          year: pubDate ? new Date(pubDate).getFullYear() : null,
          thumbnail: proxiedThumbnail,
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
  return stripCdata(m[1]);
}

function stripCdata(str) {
  return str.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
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
