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
const clients = new Map(); // 클라이언트 ID와 WebSocket 객체를 매핑

const wss = new WebSocket.Server({ server });

server.listen(serverPort);
console.log(`Server started on port ${serverPort} in stage ${process.env.NODE_ENV}`);

wss.on("connection", function (ws, req) {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  ws.clientId = clientId;

  console.log(`✅ Client connected | ID: ${clientId} | Total: ${clients.size}`);

  // 클라이언트에 ID 전송
  ws.send(JSON.stringify({
    type: 'connection',
    clientId: clientId,
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
    console.log(`❌ Client disconnected | ID: ${clientId} | Remaining: ${clients.size - 1}`);
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
