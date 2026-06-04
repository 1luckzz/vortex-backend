const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

var jobs = {};

function isValidUrl(u) {
  try { new URL(u); return true; } catch (e) { return false; }
}

app.get("/api/test", function(req, res) {
  var yt = spawn("yt-dlp", ["--version"]);
  var out = "";
  yt.stdout.on("data", function(d) { out += d.toString(); });
  yt.on("close", function() { res.json({ status: "ok", version: out.trim() }); });
});

app.post("/api/info", function(req, res) {
  var url = (req.body || {}).url;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });
  var yt = spawn("yt-dlp", ["--dump-json", "--no-warnings", url]);
  var out = "", err = "";
  yt.stdout.on("data", function(d) { out += d.toString(); });
  yt.stderr.on("data", function(d) { err += d.toString(); });
  yt.on("close", function(code) {
    if (code !== 0) return res.status(400).json({ error: err.split("\n").filter(Boolean).pop() || "failed" });
    try {
      var data = JSON.parse(out);
      var heights = [];
      (data.formats || []).forEach(function(f) { if (typeof f.height === "number") heights.push(f.height); });
      var q = ["360p","480p","720p","1080p"].filter(function(q) {
        var n = parseInt(q);
        return heights.some(function(h) { return h >= n - 30; });
      });
      res.json({ title: data.title, thumbnail: data.thumbnail, duration: data.duration, uploader: data.uploader || data.channel, availableQualities: q.length ? q : ["720p"] });
    } catch(e) { res.status(500).json({ error: "parse failed" }); }
  });
});

app.post("/api/download", function(req, res) {
  var url = (req.body || {}).url;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  var jobId = Date.now().toString();
  var filename = "video-" + jobId + ".mp4";
  var filepath = "/tmp/" + filename;

  jobs[jobId] = { status: "downloading", filepath: filepath, filename: filename };

  var yt = spawn("yt-dlp", ["--no-warnings", "--no-playlist", "--no-part", "-f", "18/22/best[ext=mp4]/best", "-o", filepath, url]);
  var err = "";
  yt.stderr.on("data", function(d) { err += d.toString(); console.log("[stderr]", d.toString().trim()); });
  yt.on("close", function(code) {
    console.log("[close] code:", code);
    if (code !== 0) {
      jobs[jobId].status = "error";
      jobs[jobId].error = err.split("\n").filter(Boolean).pop() || "failed";
    } else {
      jobs[jobId].status = "ready";
    }
  });

  res.json({ jobId: jobId });
});

app.get("/api/status/:jobId", function(req, res) {
  var job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ status: job.status, error: job.error || null });
});

app.get("/api/file/:jobId", function(req, res) {
  var job = jobs[req.params.jobId];
  if (!job || job.status !== "ready") return res.status(404).json({ error: "Not ready" });
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", "attachment; filename=\"" + job.filename + "\"");
  var stream = fs.createReadStream(job.filepath);
  stream.pipe(res);
  stream.on("finish", function() {
    fs.unlink(job.filepath, function() {});
    delete jobs[req.params.jobId];
  });
});

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log("Vortex backend on :" + PORT); });
