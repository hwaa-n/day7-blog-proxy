// Vercel Serverless Function
// 배포 경로: /api/image-proxy.js  ->  https://내프로젝트.vercel.app/api/image-proxy?url=...
//
// 네이버 이미지 서버(postfiles/blogthumb.pstatic.net 등)는 다른 도메인에서
// 브라우저가 직접 요청하면 Referer 검사로 막아버리는 경우가 있습니다.
// 그래서 이 서버가 대신 이미지를 받아온 뒤(Referer를 네이버로 위장),
// 우리 도메인에서 그대로 전달해줍니다. 프레이머 쪽에서는 이 사실을 몰라도 됩니다.

export default async function handler(req, res) {
  const url = req.query.url;

  if (!url) {
    res.status(400).send("url 파라미터가 필요합니다");
    return;
  }

  try {
    const imgRes = await fetch(url, {
      headers: {
        Referer: "https://blog.naver.com/",
        "User-Agent": "Mozilla/5.0 (compatible; blog-sync-bot/1.0)",
      },
    });

    if (!imgRes.ok) {
      throw new Error(`이미지 요청 실패: ${imgRes.status}`);
    }

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer = await imgRes.arrayBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send("이미지를 불러오지 못했습니다");
  }
}
