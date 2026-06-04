/* eslint-disable */
// Reference Node + Express + yt-dlp server for the Vortex frontend.
// Run separately (NOT on Lovable). See ./README.md
const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const QUALITY_MAP = {
  "360p": "bestvideo[height<=360]+bestaudio/best[height<=360]",
  "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]",
  "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]",
  "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
};

function isValidUrl(u) {
  try { new URL(u); return true; } catch { return false; }
}

app.post("/api/info", (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  const yt = spawn("yt-dlp", ["--dump-json", "--no-warnings", url]);
  let out = "";
  let err = "";
  yt.stdout.on("data", (d) => (out += d.toString()));
  yt.stderr.on("data", (d) => (err += d.toString()));
  yt.on("error", (e) => res.status(500).json({ error: e.message }));
  yt.on("close", (code) => {
    if (code !== 0) {
      const msg = /geo|country|unavailable|private|removed/i.test(err)
        ? "Video unavailable (geo-blocked, private, or removed)"
        : err.split("\n").filter(Boolean).pop() || "yt-dlp failed";
      return res.status(400).json({ error: msg });
    }
    try {
      const data = JSON.parse(out);
      const heights = new Set(
        (data.formats || [])
          .map((f) => f.height)
          .filter((h) => typeof h === "number")
      );
      const availableQualities = ["360p", "480p", "720p", "1080p"].filter((q) => {
        const n = parseInt(q, 10);
        return [...heights].some((h) => h >= n - 30);
      });
      res.json({
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        uploader: data.uploader || data.channel,
        availableQualities: availableQualities.length ? availableQualities : ["720p"],
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse video info" });
    }
  });
});

app.post("/api/download", (req, res) => {
  const { url, quality } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });
  const fmt = QUALITY_MAP[quality] || QUALITY_MAP["720p"];

  const filename = `video-${Date.now()}.mp4`;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const yt = spawn("yt-dlp", [
    "-f", fmt,
    "--merge-output-format", "mp4",
    "-o", "-",
    "--no-warnings",
    url,
  ]);

  yt.stdout.pipe(res);

  let err = "";
  yt.stderr.on("data", (d) => (err += d.toString()));
  yt.on("error", (e) => {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  });
  yt.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      res.end();
      console.error("yt-dlp failed:", err);
    }
  });
  req.on("close", () => yt.kill("SIGKILL"));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Vortex backend listening on :${PORT}`));
