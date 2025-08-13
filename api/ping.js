module.exports = async function (context, req) {
    const clientTimestamp = parseInt(req.query.timestamp) || Date.now();
    const serverTimestamp = Date.now();
    
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: {
            timestamp: serverTimestamp,
            clientTimestamp: clientTimestamp,
            serverProcessingTime: serverTimestamp - clientTimestamp
        }
    };
};
