const { io } = require('socket.io-client');
const db = require('./db');
const { callEvent } = require("./socket");

// Socket.IO uses http(s) URL; use env or default
const SOCKET_URL = 'https://ws.voicecallconnect.com';

let socket;
let retries = 0;
const MAX_RETRIES = 20;

function connect() {
    console.log('🔌 Connecting Socket.IO...');

    socket = io(SOCKET_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: MAX_RETRIES,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
    });

    socket.on('connect', async () => {
        console.log('✅ Connected');
        retries = 0;
    });

    socket.on('message', (data) => {
        try {
            const msg = typeof data === 'string' ? JSON.parse(data) : data;
            console.log('📩 Received:', msg);
        } catch {
            console.log('Raw:', data);
        }
    });

    socket.on('ctc_call_initiated', (data) => {
        console.log('📞 ctc_call_initiated:', data);
    });

    socket.on('call_duration_update', (data) => {
        console.log('⏱️ call_duration_update:', data);
    });

    socket.on('ctc_call_status', async (data) => {
        console.log('📋 ctc_call_status:', data);
        const { call_id, event } = data || {};
        if (!call_id || !event) return;

        const order = await db('orders').where({ call_id: String(call_id) }).first();
        if (!order) {
            console.warn('ctc_call_status: order not found for call_id', call_id);
            return;
        }
        // console.log("order", order);
        const { order_id, pandit_id, user_id, call_from, type, end_time } = order;
        console.log("order_id, pandit_id, user_id, call_from", order_id, pandit_id, user_id, call_from);
        let status;
        const call = await db('order_call_log')
            .where({ call_id: String(call_id) })
            .orderBy('id', 'desc')
            .first();
        let newEventSocket = [];
        if (event === 'destination-answered') {
            const createdAt = new Date(end_time);
            const diffSeconds = Math.floor((createdAt.getTime() - Date.now()) / 1000);
            console.log("diffSeconds", diffSeconds);
            emitCallDurationUpdate(call_id, diffSeconds)
        }
        if (call_from == 'user' && event === 'source-answered') {
            if (type == 'chat') {
                newEventSocket.push({ event: 'emit_to_u_chat_order_call_accept_astrologer', key: `user_${user_id}` })
                newEventSocket.push({ event: 'emit_to_u_chat_order_call_accept_astrologer', key: `pandit_${pandit_id}` })
                status = 'Astrologer Accepted'
            }
        }
        else if (call_from == 'user' && event === 'destination-answered') {
            if (type == 'chat') {
                status = 'User Accepted'
                newEventSocket.push({ event: 'emit_to_u_chat_order_call_accept_user', key: `pandit_${pandit_id}` })
                newEventSocket.push({ event: 'emit_to_u_chat_order_call_accept_user', key: `user_${user_id}` })
            }
        }
        else if (call_from == 'user' && event === 'hangup') {
            // call?.status || 
            if (type == 'chat') {
                if (call?.status == 'Call Initiated') {
                    status = 'Astrologer Rejected'
                    newEventSocket.push({ event: 'emit_to_u_chat_order_call_reject_astrologer', key: `user_${user_id}` })
                }

                if (call?.status == 'Astrologer Accepted') {
                    status = 'User Rejected'
                    newEventSocket.push({ event: 'emit_to_u_chat_order_call_reject_user', key: `pandit_${pandit_id}` })
                    newEventSocket.push({ event: 'emit_to_u_chat_order_call_reject_user', key: `user_${user_id}` })
                }
                if (call?.status == 'User Accepted') {
                    status = 'Call Completed'
                    newEventSocket.push({ event: 'emit_to_u_chat_order_call_completed', key: `pandit_${pandit_id}` })
                    newEventSocket.push({ event: 'emit_to_u_chat_order_call_completed', key: `user_${user_id}` })
                }
            }
        }

        //pandit condition
        else if (call_from == 'astrologer' && event === 'source-answered') {
            if (type == 'chat') {
                status = 'Astrologer Accepted'
                newEventSocket.push({ event: 'emit_to_p_chat_order_call_accept_astrologer', key: `user_${user_id}` })
                newEventSocket.push({ event: 'emit_to_p_chat_order_call_accept_astrologer', key: `pandit_${pandit_id}` })
            }
        }
        else if (call_from == 'astrologer' && event === 'destination-answered') {
            if (type == 'chat') {
                status = 'User Accepted'
                newEventSocket.push({ event: 'emit_to_p_chat_order_call_accept_user', key: `user_${user_id}` })
                newEventSocket.push({ event: 'emit_to_p_chat_order_call_accept_user', key: `pandit_${pandit_id}` })
            }
        }
        else if (call_from == 'astrologer' && event === 'hangup') {
            // call?.status || 
            if (type == 'chat') {
                if (call?.status == 'Call Initiated') {
                    status = 'Astrologer Rejected'
                    newEventSocket.push({ event: 'emit_to_p_chat_order_call_reject_astrologer', key: `pandit_${pandit_id}` })
                }
                if (call?.status == 'Astrologer Accepted') {
                    status = 'User Rejected'
                    newEventSocket.push({ event: 'emit_to_p_chat_order_call_reject_user', key: `pandit_${pandit_id}` })
                    newEventSocket.push({ event: 'emit_to_p_chat_order_call_reject_user', key: `user_${user_id}` })
                }
                if (call?.status == 'User Accepted') {
                    status = 'Call Completed'
                    newEventSocket.push({ event: 'emit_to_p_chat_order_call_completed', key: `pandit_${pandit_id}` })
                    newEventSocket.push({ event: 'emit_to_p_chat_order_call_completed', key: `user_${user_id}` })
                }
            }
        }

        console.log("newEventSocket", JSON.stringify(newEventSocket));
        await db('order_call_log').insert({ call_id, order_id, pandit_id, user_id, status })

        if (event === 'destination-answered') {
            newEventSocket.map(item => {
                callEvent(item?.event, {
                    key: item?.key,
                    payload: { order_id },
                });
            })

        } else if (event === 'source-answered') {
            newEventSocket.map(item => {
                callEvent(item?.event, {
                    key: item?.key,
                    payload: { order_id },
                });
            })

        } else if (event === 'hangup') {
            newEventSocket.map(item => {
                callEvent(item?.event, {
                    key: item?.key,
                    payload: { order_id },
                });
            })
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
        console.error('⚠️ Error:', err.message);
    });

    socket.io.on('reconnect_failed', () => {
        console.log('🔁 Socket.IO reconnection exhausted, retrying manually...');
        retries = 0;
        retryConnect();
    });
}

function callSocketEvent(event, data) {
    if (socket?.connected) {
        socket.emit(event, data);
    } else {
        console.warn('Socket not connected, event not sent:', event);
    }
}

/**
 * Emit call_duration_update: { call_id, duration } — duration in seconds (string).
 */
function emitCallDurationUpdate(callId, durationInSeconds) {
    console.log("durationInSeconds", durationInSeconds);
    callSocketEvent('call_duration_update', {
        call_id: callId,
        duration: String(durationInSeconds),
    });
}

function retryConnect() {
    if (retries >= MAX_RETRIES) return;

    const delay = Math.min(1000 * 2 ** retries, 10000);
    retries++;

    console.log(`🔁 Reconnect in ${delay}ms`);
    setTimeout(connect, delay);
}

connect();

module.exports = { callSocketEvent, emitCallDurationUpdate };
