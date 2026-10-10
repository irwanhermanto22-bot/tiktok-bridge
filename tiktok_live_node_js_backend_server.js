// Node.js Backend Server - TikTok Live Bridge
// Berfungsi menghubungkan TikTok Live asli ke Aplikasi Android TikTok Hub via Socket.io

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const cors = require('cors');

const app = express();
// Mengaktifkan CORS agar aplikasi Android / Web bisa terhubung tanpa diblokir
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Inisialisasi WebSocket Server dengan Socket.io
const io = new Server(server, {
    cors: {
        origin: "*", // Mengizinkan koneksi dari IP/Aplikasi manapun
        methods: ["GET", "POST"]
    }
});

// Endpoint sederhana untuk mengecek apakah server backend berjalan dengan baik
app.get('/', (req, res) => {
    res.json({
        status: 'ONLINE',
        message: 'Server TikTok Live Bridge berjalan dengan baik!',
        timestamp: new Date().toISOString()
    });
});

// Menyimpan koneksi TikTok per Client Socket ID
const activeTikTokConnections = new Map();

io.on('connection', (socket) => {
    console.log(`[Socket] App Client terhubung: ID (${socket.id})`);

    // Menerima perintah sambung ke TikTok Username tertentu dari Aplikasi Android
    socket.on('CONNECT_TIKTOK', (data) => {
        const username = typeof data === 'string' ? data : data.username;

        if (!username) {
            socket.emit('TIKTOK_STATUS', { 
                status: 'ERROR', 
                message: 'Username TikTok tidak boleh kosong!' 
            });
            return;
        }

        console.log(`[TikTok] Mencoba menghubungkan ke ruang live: @${username}`);

        // Pembersihan jika socket ini sudah punya koneksi sebelumnya
        if (activeTikTokConnections.has(socket.id)) {
            try {
                activeTikTokConnections.get(socket.id).disconnect();
            } catch (e) {
                console.error('[TikTok] Gagal menutup koneksi lama:', e.message);
            }
            activeTikTokConnections.delete(socket.id);
        }

        // Membuat instance koneksi baru ke TikTok Live
        const tiktokConnection = new WebcastPushConnection(username, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            requestOptions: {
                timeout: 10000
            }
        });

        // Menyimpan instance koneksi ke dalam Map
        activeTikTokConnections.set(socket.id, tiktokConnection);

        tiktokConnection.connect().then(state => {
            console.log(`[TikTok] BERHASIL Terhubung ke Room ID: ${state.roomId} (@${username})`);
            
            socket.emit('TIKTOK_STATUS', { 
                status: 'CONNECTED', 
                roomId: state.roomId,
                username: username,
                message: `Terhubung ke Live @${username}`
            });
        }).catch(err => {
            console.error(`[TikTok] GAGAL Terhubung ke @${username}:`, err.message);
            
            socket.emit('TIKTOK_STATUS', { 
                status: 'ERROR', 
                message: `Gagal terhubung ke @${username}. Pastikan akun sedang LIVE!` 
            });
            
            activeTikTokConnections.delete(socket.id);
        });

        // 1. EVENT KOMENTAR REAL-TIME
        tiktokConnection.on('chat', data => {
            console.log(`[Chat] @${data.uniqueId}: ${data.comment}`);
            
            socket.emit('TIKTOK_COMMENT', {
                user: data.uniqueId,
                nickname: data.nickname,
                comment: data.comment,
                avatar: data.profilePictureUrl,
                timestamp: new Date().toLocaleTimeString()
            });
        });

        // 2. EVENT GIFT REAL-TIME
        tiktokConnection.on('gift', data => {
            // Mengirim event gift jika gift berturut-turut selesai (repeatEnd) atau gift non-combo
            if (data.giftType === 1 && data.repeatEnd) {
                console.log(`[Gift] @${data.uniqueId} mengirim ${data.repeatCount}x ${data.giftName}`);
                
                socket.emit('TIKTOK_GIFT', {
                    user: data.uniqueId,
                    nickname: data.nickname,
                    giftName: data.giftName,
                    repeatCount: data.repeatCount,
                    diamondCount: data.diamondCount * data.repeatCount,
                    avatar: data.profilePictureUrl,
                    timestamp: new Date().toLocaleTimeString()
                });
            } else if (data.giftType !== 1) {
                console.log(`[Gift] @${data.uniqueId} mengirim ${data.giftName}`);
                
                socket.emit('TIKTOK_GIFT', {
                    user: data.uniqueId,
                    nickname: data.nickname,
                    giftName: data.giftName,
                    repeatCount: 1,
                    diamondCount: data.diamondCount,
                    avatar: data.profilePictureUrl,
                    timestamp: new Date().toLocaleTimeString()
                });
            }
        });

        // 3. EVENT KONEKSI TERPUTUS / SERVER KELUAR
        tiktokConnection.on('streamEnd', () => {
            console.log(`[TikTok] Live Stream @${username} telah berakhir.`);
            socket.emit('TIKTOK_STATUS', { 
                status: 'ENDED', 
                message: 'Live Streaming TikTok telah selesai.' 
            });
        });

        tiktokConnection.on('disconnected', () => {
            console.log(`[TikTok] Koneksi TikTok terputus untuk @${username}`);
            socket.emit('TIKTOK_STATUS', { 
                status: 'DISCONNECTED', 
                message: 'Koneksi ke TikTok terputus.' 
            });
        });

        tiktokConnection.on('error', err => {
            console.error('[TikTok Error]', err);
        });
    });

    // Pembersihan ketika Aplikasi HP memutus koneksi WebSocket
    socket.on('disconnect', () => {
        console.log(`[Socket] App Client terputus: ID (${socket.id})`);
        if (activeTikTokConnections.has(socket.id)) {
            try {
                activeTikTokConnections.get(socket.id).disconnect();
            } catch (e) {
                console.error('[TikTok Disconnect Error]', e.message);
            }
            activeTikTokConnections.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 TikTok Live Bridge Server berjalan di port ${PORT}`);
    console.log(`📡 URL Lokal: http://localhost:${PORT}`);
    console.log(`====================================================`);
});