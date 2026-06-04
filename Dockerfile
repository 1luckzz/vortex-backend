FROM node:20-slim
RUN apt-get update && apt-get install -y python3 curl ffmpeg && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp
WORKDIR /app
COPY package.json .
RUN npm install
COPY index.js .
EXPOSE 8080
CMD ["node", "index.js"]