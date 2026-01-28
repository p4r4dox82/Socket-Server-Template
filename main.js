const http = require("http");
const express = require("express");
const app = express();
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");

app.use(express.static("public"));
// require("dotenv").config();

const serverPort = process.env.PORT || 3000;
const server = http.createServer(app);

let keepAliveId;
const clients = new Map(); // 클라이언트 ID -> {ws, port} 매핑

// WebRTC 포트 분배 시스템
const TOTAL_WEBRTC_PORTS = 5;
const WEBRTC_BASE_PORT = 500;
const availablePorts = new Set();

// 초기 포트 풀 생성
for (let i = 0; i < TOTAL_WEBRTC_PORTS; i++) {
  availablePorts.add(WEBRTC_BASE_PORT + i);
}

console.log(`🎯 WebRTC Port Pool initialized: ${TOTAL_WEBRTC_PORTS} ports (${WEBRTC_BASE_PORT}-${WEBRTC_BASE_PORT + TOTAL_WEBRTC_PORTS - 1})`);

// 포트 할당
const allocatePort = () => {
  if (availablePorts.size === 0) {
    console.warn('⚠️  No available ports!');
    return null;
  }
  const port = availablePorts.values().next().value;
  availablePorts.delete(port);
  return port;
};

// 포트 반환
const releasePort = (port) => {
  if (port && !availablePorts.has(port)) {
    availablePorts.add(port);
    console.log(`♻️  Port released | Port: ${port} | Available: ${availablePorts.size}/${TOTAL_WEBRTC_PORTS}`);
  }
};

const wss = new WebSocket.Server({ server });

server.listen(serverPort);
console.log(`Server started on port ${serverPort} in stage ${process.env.NODE_ENV}`);

wss.on("connection", function (ws, req) {
  const clientId = uuidv4();
  const webrtcPort = allocatePort();
  
  clients.set(clientId, {
    ws: ws,
    webrtcPort: webrtcPort
  });
  ws.clientId = clientId;
  ws.webrtcPort = webrtcPort;

  console.log(`✅ Client connected | ID: ${clientId} | Port: ${webrtcPort} | Total: ${clients.size} | Available: ${availablePorts.size}/${TOTAL_WEBRTC_PORTS}`);

  // 환영 메시지 + 클라이언트 ID + WebRTC 포트 전송
  if (webrtcPort === null) {
    console.warn(`⚠️  No available ports for client ${clientId}. Sending error.`);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'No available WebRTC ports',
      timestamp: new Date().toISOString()
    }));
    ws.close(1008, 'No available ports');
    clients.delete(clientId);
    return;
  }

  ws.send(JSON.stringify({
    type: 'connection',
    clientId: clientId,
    webrtcPort: webrtcPort,
    message: 'Welcome to WebSocket Server',
    timestamp: new Date().toISOString()
  }));

  if (clients.size === 1) {
    console.log("first connection. starting keepalive");
    keepServerAlive();
  }

  ws.on("message", (data) => {
    let stringifiedData = data.toString();
    if (stringifiedData === 'pong') {
      console.log('keepAlive');
      return;
    }
    broadcast(ws, stringifiedData, false);
  });

  ws.on("close", (data) => {
    const clientData = clients.get(clientId);
    if (clientData && clientData.webrtcPort) {
      releasePort(clientData.webrtcPort);
    }
    
    console.log(`❌ Client disconnected | ID: ${clientId} | Remaining: ${clients.size - 1} | Available: ${availablePorts.size}/${TOTAL_WEBRTC_PORTS}`);
    clients.delete(clientId);

    if (clients.size === 0) {
      console.log("last client disconnected, stopping keepAlive interval");
      clearInterval(keepAliveId);
    }
  });
});

// Implement broadcast function because of ws doesn't have it
const broadcast = (ws, message, includeSelf) => {
  if (includeSelf) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  } else {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
};

/**
 * Sends a ping message to all connected clients every 50 seconds
 */
 const keepServerAlive = () => {
  keepAliveId = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send('ping');
      }
    });
  }, 50000);
};


app.get('/', (req, res) => {
    res.send('Hello World!');
});

// 서버 상태 확인 엔드포인트
app.get('/status', (req, res) => {
    res.json({
        status: 'active',
        connectedClients: clients.size,
        clientIds: Array.from(clients.keys()),
        timestamp: new Date().toISOString()
    });
});
