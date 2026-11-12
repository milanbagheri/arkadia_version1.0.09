const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;

app.use(express.static('public'));

const MAX_PLAYERS = 4;
const MAP = { width: 900, height: 700 };
const countries = {
  'ایران': { x: 200, y: 150 },
  'ترکیه': { x: 700, y: 150 },
  'آلمان': { x: 200, y: 550 },
  'ژاپن': { x: 700, y: 550 },
  'برزیل': { x: 450, y: 150 },
  'استرالیا': { x: 450, y: 550 }
};
const players = new Map();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function publicState() {
  return {
    map: MAP,
    players: [...players.values()].map(({ id, name, country, x, y, money, power, stability }) =>
      ({ id, name, country, x, y, money, power, stability }))
  };
}
function broadcast() { io.emit('state', publicState()); }

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  socket.on('join', (input = {}) => {
    if (players.has(socket.id)) return;
    if (players.size >= MAX_PLAYERS) return socket.emit('notice', 'ظرفیت بازی پر است.');
    const country = String(input.country || '');
    if (!Object.hasOwn(countries, country)) return socket.emit('notice', 'کشور انتخاب‌شده معتبر نیست.');
    if ([...players.values()].some(p => p.country === country))
      return socket.emit('notice', 'این کشور را بازیکن دیگری انتخاب کرده است.');

    const base = countries[country];
    const name = String(input.name || 'بازیکن').trim().slice(0, 18) || 'بازیکن';
    players.set(socket.id, {
      id: socket.id, name, country,
      x: base.x, y: base.y,
      money: 500, income: 25, power: 10, stability: 100,
      lastMove: 0, lastAttack: 0
    });
    socket.emit('joined', { id: socket.id });
    broadcast();
  });

  socket.on('move', (input = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastMove < 70) return;
    p.lastMove = now;
    const dx = Number(input.dx), dy = Number(input.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const length = Math.hypot(dx, dy) || 1;
    const step = 12;
    p.x = clamp(p.x + (dx / length) * step, 25, MAP.width - 25);
    p.y = clamp(p.y + (dy / length) * step, 25, MAP.height - 25);
    broadcast();
  });

  socket.on('buy_troops', () => {
    const p = players.get(socket.id);
    if (!p) return;
    const cost = 100;
    if (p.money < cost) return socket.emit('notice', 'بودجهٔ کافی ندارید.');
    p.money -= cost;
    p.power += 5;
    broadcast();
  });

  socket.on('attack', () => {
    const attacker = players.get(socket.id);
    if (!attacker) return;
    const now = Date.now();
    if (now - attacker.lastAttack < 1500) return socket.emit('notice', 'کمی صبر کنید و دوباره حمله کنید.');
    attacker.lastAttack = now;
    const target = [...players.values()]
      .filter(p => p.id !== attacker.id)
      .map(p => ({ p, d: Math.hypot(p.x - attacker.x, p.y - attacker.y) }))
      .filter(item => item.d <= 110)
      .sort((a, b) => a.d - b.d)[0]?.p;
    if (!target) return socket.emit('notice', 'حریفی در بُرد حمله نیست؛ به او نزدیک شوید.');

    if (attacker.power > target.power) {
      target.stability = Math.max(0, target.stability - 20);
      attacker.money += 50;
      socket.emit('notice', `حمله به ${target.name} موفق بود؛ ۵۰ سکه غنیمت گرفتید.`);
      if (target.stability === 0) {
        players.delete(target.id);
        io.to(target.id).emit('notice', 'ثبات کشور شما به صفر رسید و از این دور حذف شدید.');
      }
    } else {
      attacker.stability = Math.max(0, attacker.stability - 15);
      socket.emit('notice', 'حمله دفع شد؛ قدرت شما از حریف بیشتر نیست.');
    }
    broadcast();
  });

  socket.on('disconnect', () => {
    if (players.delete(socket.id)) broadcast();
  });
});

setInterval(() => {
  for (const p of players.values()) p.money += p.income;
  broadcast();
}, 10000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Arcadia is running on port ${PORT}`);
});
