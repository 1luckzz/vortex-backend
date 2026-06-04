const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const QUALITY_MAP = {
  "360p": "bestvideo[height<=360]+bestaudio/best[height<=360]",
  "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]",
  "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]",
  "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
};

function isValidUrl(u) {
  try { new URL(u); return true; } catch (e) { return false; }
}

app.post("/api/info", function(req, res) {
  var url = (req.body || {}).url;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  var yt = spawn("yt-dlp", ["--dump-json", "--no-warnings", url]);
  var out = "";
  var err = "";
  yt.stdout.on("data", function(d) { out += d.toString(); });
  yt.stderr.on("data", function(d) { err += d.toString(); });
  yt.on("error", function(e) { res.status(500).json({ error: e.message }); });
  yt.on("close", function(code) {
    if (code !== 0) return res.status(400).json({ error: err.split("\n").filter(Boolean).pop() || "yt-dlp failed" });
    try {
      var data = JSON.parse(out);
      var heights = [];
      (data.formats || []).forEach(function(f) {
        if (typeof f.height === "number") heights.push(f.height);
      });
      var availableQualities = ["360p", "480p", "720p", "1080p"].filter(function(q) {
        var n = parseInt(q, 10);
        return heights.some(function(h) { return h >= n - 30; });
      });
      res.json({
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        uploader: data.uploader || data.channel,
        availableQualities: availableQualities.length ? availableQualities : ["720p"]
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse video info" });
    }
  });
});

app.post("/api/download", function(req, res) {
  var body = req.body || {};
  var url = body.url;
  var quality = body.quality;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });
  var filename = "video-" + Date.now() + ".mp4";
  var filepath = "/tmp/" + filename;

  var yt = spawn("yt-dlp", [
    "--no-warnings",
    "--concurrent-fragments", "4",
    "--merge-output-format", "mp4",
    "-o", filepath,
    url
  ]);

  var err = "";
  yt.stderr.on("data", function(d) { err += d.toString(); });
  yt.on("error", function(e) { res.status(500).json({ error: e.message }); });
  yt.on("close", function(code) {
    if (code !== 0) return res.status(500).json({ error: err.split("\n").filter(Boolean).pop() || "Download failed" });
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
    var stream = fs.createReadStream(filepath);
    stream.pipe(res);
    stream.on("close", function() { fs.unlink(filepath, function() {}); });
  });

  req.on("close", function() { yt.kill("SIGKILL"); });
});

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log("Vortex backend listening on :" + PORT); });
