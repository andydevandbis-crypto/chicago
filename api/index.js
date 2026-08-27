// api/index.js
// Chicago API - Serverless Function

module.exports = (req, res) => {
    // Sätt CORS-headers så att din frontend kan ansluta
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Hantera preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Routing baserat på URL
    const url = req.url;

    // Status-endpoint
    if (url === '/api/status' || url === '/status') {
        res.status(200).json({ 
            status: 'online', 
            message: 'Chicago-server är igång! 🎲',
            timestamp: new Date().toISOString(),
            endpoints: {
                status: '/api/status',
                players: '/api/players',
                game: '/api/game'
            }
        });
        return;
    }

    // Spelar-endpoint (exempel)
    if (url === '/api/players' || url === '/players') {
        res.status(200).json({
            players: ['Spelare 1', 'Spelare 2', 'Spelare 3'],
            count: 3
        });
        return;
    }

    // Game-endpoint (exempel)
    if (url === '/api/game' || url === '/game') {
        res.status(200).json({
            game: 'Chicago',
            status: 'waiting',
            currentRound: 0
        });
        return;
    }

    // Default-svar
    res.status(200).json({
        message: 'Välkommen till Chicago API! 🎰',
        endpoints: {
            status: '/api/status',
            players: '/api/players',
            game: '/api/game'
        },
        documentation: 'Använd /api/status för att kolla serverstatus'
    });
};