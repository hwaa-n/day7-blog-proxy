// Vercel Serverless Function
// 배포 경로: /api/naver-blog.js  ->  https://내프로젝트.vercel.app/api/naver-blog
//
// 하는 일:
// 1) 네이버 블로그 RSS를 서버에서 대신 읽어온다 (최신 5개만).
// 2) 각 글의 title / link / pubDate / thumbnail / tags(최대 5개)를 추출한다.
//    - 썸네일: RSS 본문 첫 이미지 -> 없으면 포스트 페이지의 og:image
//    - 태그: 포스트 페이지의 article:tag 메타 -> 없으면 본문 안 "#태그" 링크 텍스트
// 3) 이미지 주소는 우리 서버의 /api/image-proxy 를 거치도록 감싸서 반환한다.
//    (네이버 이미지 서버가 다른 도메인에서의 직접 요청을 막는 경우가 있어서)

const BLOG_ID = "paintday7";
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;
const MAX_ITEMS = 5; // 최신 5개까지만 노출
const MAX_TAGS = 5;

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
        let tags = [];

        if (link) {
          const meta = await fetchPostMeta(link);
          if (!thumbnail) thumbnail = meta.ogImage;
          tags = meta.tags;
        }

        // 태그를 하나도 못 찾았을 때만 RSS 카테고리로 대체
        if (tags.length === 0) {
          tags = [...block.matchAll(/<category>([\s\S]*?)<\/category>/g)]
            .map((m) => decodeEntities(stripCdata(m[1])))
            .filter((t) => t.length > 0);
        }

        const proxiedThumbnail = thumbnail
          ? `${origin}/api/image-proxy?url=${encodeURIComponent(thumbnail)}`
          : null;

        return {
          title,
          link,
          pubDate,
          year: pubDate ? new Date(pubDate).getFullYear() : null,
          tags: tags.slice(0, MAX_TAGS),
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

async function fetchPostMeta(url) {
  try {
    const outerHtml = await fetchHtml(url);

    const ogImage = extractOgImage(outerHtml);
    let tags = extractArticleTags(outerHtml);
    if (tags.length === 0) tags = extractHashtagLinks(outerHtml);

    // 겉 페이지(blog.naver.com/.../글번호)에는 대표이미지 메타만 있고
    // 실제 태그는 <iframe id="mainFrame">로 불러오는 안쪽 본문에 있는 경우가 많다.
    // 겉에서 못 찾았으면 그 iframe 주소를 따라 들어가서 한 번 더 시도한다.
    if (tags.length === 0) {
      const iframeSrc = extractMainFrameSrc(outerHtml);
      if (iframeSrc) {
        const iframeUrl = iframeSrc.startsWith("http")
          ? iframeSrc
          : `https://blog.naver.com${iframeSrc}`;
        const innerHtml = await fetchHtml(iframeUrl);
        tags = extractArticleTags(innerHtml);
        if (tags.length === 0) tags = extractHashtagLinks(innerHtml);
      }
    }

    return { ogImage, tags };
  } catch {
    return { ogImage: null, tags: [] };
  }
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; blog-sync-bot/1.0)",
      Referer: "https://blog.naver.com/",
    },
  });
  return r.text();
}

function extractOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function extractArticleTags(html) {
  return [...html.matchAll(
    /<meta[^>]+property=["']article:tag["'][^>]+content=["']([^"']+)["']/gi
  )]
    .map((m) => decodeEntities(m[1].trim()))
    .filter((t) => t.length > 0);
}

function extractHashtagLinks(html) {
  const seen = new Set();
  return [...html.matchAll(/>#([^<#]{1,30})<\/a>/g)]
    .map((m) => decodeEntities(m[1].trim()))
    .filter((t) => {
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

function extractMainFrameSrc(html) {
  const m = html.match(/<iframe[^>]+id=["']mainFrame["'][^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}
