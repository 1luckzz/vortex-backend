const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function isValidUrl(u) {
  try { new URL(u); return true; } catch (e) { return false; }
}

app.get("/api/test", function(req, res) {
  var yt = spawn("yt-dlp", ["--version"]);
  var out = "";
  yt.stdout.on("data", function(d) { out += d.toString(); });
  yt.on("close", function() {
    res.json({ status: "ok", yt_dlp_version: out.trim() });
  });
});

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
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  var filename = "video-" + Date.now() + ".mp4";
  var filepath = "/tmp/" + filename;

  console.log("[download] starting:", url);

  var yt = spawn("yt-dlp", [
    "--no-warnings",
    "--no-playlist",
    "--no-part",
    "-f", "18/22/best[ext=mp4]/best",
    "-o", filepath,
    url
  ]);

  var err = "";

  yt.stderr.on("data", function(d) {
    err += d.toString();
    console.log("[stderr]", d.toString().trim());
  });

  yt.on("error", function(e) {
    console.log("[spawn error]", e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  });

  yt.on("close", function(code) {
    console.log("[close] code:", code);
    if (code !== 0) {
      if (!res.headersSent) res.status(500).json({ error: err.split("\n").filter(Boolean).pop() || "Download failed" });
      return;
    }
    fs.stat(filepath, function(statErr, stats) {
      if (statErr || !stats || stats.size === 0) {
        console.log("[stat error]", statErr);
        if (!res.headersSent) res.status(500).json({ error: "File empty or not found" });
        return;
      }
      console.log("[file size]", stats.size);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
      res.setHeader("Content-Length", stats.size);
      var stream = fs.createReadStream(filepath);
      stream.pipe(res);
      stream.on("finish", function() {
        fs.unlink(filepath, function() {});
      });
    });
  });
});

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log("Vortex backend listening on :" + PORT); });
