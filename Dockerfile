# ===== 建置階段 =====
FROM node:20-alpine AS builder

WORKDIR /app

# 複製 package 設定並安裝依賴
COPY package.json ./
RUN npm install

# 複製源碼並編譯 TypeScript
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run compile

# ===== 圖示轉換階段 =====
FROM node:20-alpine AS icons

RUN apk add --no-cache rsvg-convert

WORKDIR /icons
COPY icons/icon.svg ./icon.svg
RUN rsvg-convert -w 16 -h 16 icon.svg -o icon16.png && \
    rsvg-convert -w 48 -h 48 icon.svg -o icon48.png && \
    rsvg-convert -w 128 -h 128 icon.svg -o icon128.png

# ===== 打包階段 =====
FROM builder AS packager

# 複製所有需要打包的資源
COPY media/ ./media/
COPY icons/ ./icons/
COPY --from=icons /icons/icon16.png /icons/icon48.png /icons/icon128.png ./icons/
COPY .vscodeignore ./

# 安裝 vsce 並打包成 .vsix
RUN mkdir -p /output && \
    npm install -g @vscode/vsce && \
    vsce package --no-dependencies --allow-missing-repository --out /output/vscode-2fa-authenticator.vsix

# ===== 輸出階段 =====
FROM scratch AS output
COPY --from=packager /output/vscode-2fa-authenticator.vsix /
