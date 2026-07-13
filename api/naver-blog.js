// Vercel Serverless Function
// 배포 경로: /api/naver-blog.js  ->  https://내프로젝트.vercel.app/api/naver-blog
//
// 하는 일:
// 1) 네이버 블로그 RSS(https://rss.blog.naver.com/{BLOG_ID}.xml)를 서버에서 대신 읽어온다.
//    (브라우저에서 직접 fetch하면 CORS로 막히기 때문에, 반드시 서버를 거쳐야 함)
// 2) 각 글의 title / link / pubDate / category(해시태그) / thumbnail(대표 이미지)을 추출한다.
// 3) 결과를 캐싱 헤더와 함께 JSON으로 반환한다. (프레이머는 이 JSON만 받아서 그리면 됨)

const BLOG_ID = "paintday7";
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;
const MAX_ITEMS = 8;

export default async function handler(req, res) {
  try {
    const rssRes = await fetch(RSS_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; blog-sync-bot/1.0)" },
    });

    if (!rssRes.ok) {
      throw new Error(`RSS 요청 실패: ${rssRes.status}`);
    }

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
        const categories = [...block.matchAll(/<category>([\s\S]*?)<\/category>/g)]
          .map((m) => decodeEntities(stripCdata(m[1])))
          .filter((t) => t.length > 0);

        // 1차: RSS 본문(description) 안의 첫 번째 이미지
        let thumbnail = firstImgSrc(description);

        // 2차: RSS에 이미지가 없으면 실제 포스트 페이지의 og:image 메타태그에서 가져옴
        if (!thumbnail && link) {
          thumbnail = await fetchOgImage(link);
        }

        return {
          title,
          link,
          pubDate,
          year: pubDate ? new Date(pubDate).getFullYear() : null,
          tags: categories, // 예: ["원상복구", "서울", "강서구"]
          thumbnail: thumbnail || null,
        };
      })
    );

    // CDN 캐시: 30분 동안은 캐시된 응답을 주고, 이후엔 백그라운드에서 갱신
    // (네이버 서버에 매 방문마다 요청 보내지 않도록 하는 안전장치)
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.setHeader("Access-Control-Allow-Origin", "*"); // 프레이머 도메인에서 fetch 가능하도록
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

// <![CDATA[ ... ]]> 래퍼와 앞뒤 공백을 함께 제거 (category 등 여러 곳에서 재사용)
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
