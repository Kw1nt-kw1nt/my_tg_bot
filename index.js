const TelegramBot = require('node-telegram-bot-api');
const Datastore = require('nedb');

// Твой токен от BotFather
const token = '8790945251:AAF83uifgaVJucNG7sOTb0SdwFf88t4IB60'; 
const bot = new TelegramBot(token, { polling: { params: { offset: -1 } } });
const db = new Datastore({ filename: 'database.db', autoload: true });

// Создаем веб-сервер для UptimeRobot, чтобы бот работал 24/7
const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Game Bot is Alive\n');
}).listen(process.env.PORT || 3000);

const activeTrades = new Map();
const regState = new Map();

// Глобальный счетчик ID игроков
let globalPlayerCount = 1;
db.find({}, (err, docs) => {
    if (docs && docs.length > 0) {
        const maxId = Math.max(...docs.map(d => d.gameId || 1));
        globalPlayerCount = maxId + 1;
    }
});

// Справочник кастомизации карточек и флагов
const COSMETICS = {
    cards: {
        'default': { name: '⬛ Обычная черная', icon: '⬛' },
        'gold': { name: '🟨 Золотистая', icon: '🟨' },
        'diamond': { name: '🔷 Алмазная', icon: '🔷' },
        'emerald': { name: '🟩 Изумрудная', icon: '🟩' },
        'azure': { name: '🔵 Лазурная', icon: '🔵' }
    },
    flags: {
        'none': { name: 'Нет флага', icon: '🏳️' },
        'ru': { name: '🇷🇺 Флаг РФ', icon: '🇷🇺' },
        'de': { name: '🇩🇪 Флаг Германии', icon: '🇩🇪' },
        'us': { name: '🇺🇸 Флаг США', icon: '🇺🇸' }
    }
};

// Функция для получения и обновления профиля (доход и налог)
function getProfile(userId, callback) {
    db.findOne({ userId: userId }, (err, doc) => {
        if (err) return callback(err, null);
        if (doc) {
            const now = Date.now();
            if (doc.business && doc.business.hasBusiness) {
                const hoursPassed = Math.floor((now - doc.business.lastUpdate) / (1000 * 60 * 60));
                if (hoursPassed > 0) {
                    const income = doc.business.videoCards * 10000 * hoursPassed;
                    const taxIncrease = 5000 * hoursPassed;
                    
                    doc.rubles += income;
                    doc.business.tax += taxIncrease;
                    doc.business.lastUpdate = now;

                    const threeDays = 3 * 24 * 60 * 60 * 1000;
                    if (now - doc.business.buyTime > threeDays && doc.business.tax > 0) {
                        doc.business = { hasBusiness: false, videoCards: 0, tax: 0, buyTime: 0, lastUpdate: 0 };
                        bot.sendMessage(userId, "⚠️ Ваш бизнес был изъят за неуплату налогов в течение 3-х реальных дней!");
                    }
                    if (doc.business.tax > 1500000) doc.business.tax = 1500000;
                    db.update({ userId: userId }, doc, {}, () => {});
                }
            }
            if (doc.rubles >= 1000000 && !doc.stats.firstMillionDate) {
                doc.stats.firstMillionDate = new Date().toLocaleDateString('ru-RU');
                db.update({ userId: userId }, doc, {}, () => {});
            }
            return callback(null, doc);
        }
        return callback(null, null);
    });
}

function isAdmin(msg, profile) {
    if (msg.from.username === 'cuqow') return true;
    if (profile && profile.isAdmin) return true;
    return false;
}
// Главный обработчик сообщений
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const text = msg.text;
    if (!text) return;

    // Логика регистрации никнейма
    if (regState.has(userId)) {
        const cleanNick = text.trim();
        if (!/^[a-zA-Z0-9а-яА-ЯёЁ]+$/.test(cleanNick)) {
            return bot.sendMessage(msg.chat.id, "❌ Ник должен состоять только из букв РФ/Англ и цифр! Введите еще раз:");
        }

        db.findOne({ nickname: cleanNick }, (err, existing) => {
            if (existing) return bot.sendMessage(msg.chat.id, "❌ Этот ник уже занят! Придумайте другой:");

            const newPlayer = {
                userId: userId,
                gameId: globalPlayerCount++,
                nickname: cleanNick,
                rubles: 5000,
                shmatochki: 0,
                casinoGames: 0,
                cases: { daily: 0, bomzh: 0, rabochiy: 0, biz: 0, bogach: 0, mazhor: 0 },
                business: { hasBusiness: false, videoCards: 0, tax: 0, buyTime: 0, lastUpdate: 0 },
                inventory: { cards: ['default'], flags: ['none'] },
                equipped: { card: 'default', flag: 'none' },
                stats: { regDate: new Date().toLocaleDateString('ru-RU'), firstMillionDate: null },
                lastDaily: 0,
                isAdmin: false
            };

            db.insert(newPlayer, () => {
                regState.delete(userId);
                bot.sendMessage(msg.chat.id, `🎉 Регистрация успешна, ${cleanNick}! Твой ID: *${newPlayer.gameId}*\nВведите /help для просмотра команд.`, { parse_mode: 'Markdown' });
            });
        });
        return;
    }

    if (text === '/start') {
        getProfile(userId, (err, p) => {
            if (p) return bot.sendMessage(msg.chat.id, `Вы уже в игре! Ваш игровой ID: ${p.gameId}`);
            bot.sendMessage(msg.chat.id, "👋 Привет! Введите ваш игровой Никнейм (только обычные буквы и цифры):");
            regState.set(userId, true);
        });
    }

    if (text === '/help') {
        const helpText = `📋 *Все команды игры:*\n\n` +
            `/p — Профиль и баланс\n` +
            `/cards — Просмотр красивой карточки игрока\n` +
            `/inventory — Твой инвентарь кастомизаций карточки\n` +
            `/case — Покупка и открытие кейсов\n` +
            `/bonus — Получить ежедневный бонус кейсов\n` +
            `/createb — Создать майнинг бизнес (500.000 ₽)\n` +
            `/b — Информация о бизнесе и видеокартах\n` +
            `/trade [Ник] — Обмен с игроком\n` +
            `/casino [ставка] — Испытать удачу в казино\n\n` +
            `👑 *Разработчик:* @cuqow`;
        bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
    }

    if (text === '/p') {
        getProfile(userId, (err, p) => {
            if (!p) return bot.sendMessage(msg.chat.id, "❌ Зарегистрируйтесь через /start");
            const res = `👤 Профиль: *${p.nickname}* [ID: ${p.gameId}]\n\n` +
                `💳 Рубли: ${p.rubles.toLocaleString()} ₽\n` +
                `💎 Шматочки: ${p.shmatochki}\n` +
                `🎰 Игр в казино: ${p.casinoGames}\n` +
                `🖥 Видеокарты: ${p.business.hasBusiness ? p.business.videoCards : 0} шт.`;
            bot.sendMessage(msg.chat.id, res, { parse_mode: 'Markdown' });
        });
    }

    if (text === '/cards') {
        getProfile(userId, async (err, p) => {
            if (!p) return bot.sendMessage(msg.chat.id, "❌ Напишите /start для регистрации.");
            const cardDesign = COSMETICS.cards[p.equipped.card].icon;
            const flagDesign = COSMETICS.flags[p.equipped.flag].icon;
            const millionStatus = p.stats.firstMillionDate ? `🏆 Первый лям: ${p.stats.firstMillionDate}` : "💸 Первый лям: Еще нет";

            const cardVisual = 
                `————————————————————\n` +
                `${cardDesign} *КАРТОЧКА ИГРОКА*       ${flagDesign}\n` +
                `————————————————————\n` +
                `👤 *Ник:* ${p.nickname}\n` +
                `🆔 *Игровой ID:* ${p.gameId}\n` +
                `📅 *Дата рег:* ${p.stats.regDate}\n` +
                `💰 *Состояние:* ${p.rubles.toLocaleString()} ₽\n` +
                `💎 *Донат:* ${p.shmatochki} шматочков\n` +
                `🖥 *Майнинг:* ${p.business.hasBusiness ? p.business.videoCards : 0} видеокарт\n` +
                `📋 ${millionStatus}\n` +
                `————————————————————`;
            bot.sendMessage(msg.chat.id, cardVisual, { parse_mode: 'Markdown' });
        });
    }

    if (text === '/inventory') {
        getProfile(userId, (err, p) => {
            if (!p) return;
            const textMenu = `🎒 *Твой инвентарь кастомизаций*\n\n` +
                `🎭 Текущая карточка: ${COSMETICS.cards[p.equipped.card].name}\n` +
                `🚩 Текущий флаг: ${COSMETICS.flags[p.equipped.flag].name}\n\n` +
                `Выберите категорию для смены стиля:`;
            bot.sendMessage(msg.chat.id, textMenu, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🖼️ Выбрать карточку", callback_data: `inv_cat_cards_${userId}` }],
                        [{ text: "🚩 Выбрать флаг", callback_data: `inv_cat_flags_${userId}` }]
                    ]
                }
            });
        });
    }
  if (text === '/case') {
        getProfile(userId, (err, p) => {
            if (!p) return;
            const caseMenu = `📦 *Магазин и Открытие Кейсов*:\n\n` +
                `1. Ежедневный кейс (В наличии: ${p.cases.daily})\n` +
                `2. Кейс Бомжа — 1.000 ₽ (${p.cases.bomzh} шт.)\n` +
                `3. Кейс Рабочего — 10.000 ₽ (${p.cases.rabochiy} шт.)\n` +
                `4. Кейс Бизнесмена — 100.000 ₽ (${p.cases.biz} шт.)\n` +
                `5. Кейс Богача — 1.000.000 ₽ (${p.cases.bogach} шт.)\n` +
                `6. Кейс Мажора — 10.000.000 ₽ (${p.cases.mazhor} шт.)`;
            bot.sendMessage(msg.chat.id, caseMenu, {
                reply_markup: {
                    inline_keyboard: [[{ text: "🛒 Купить кейс", callback_data: `menu_buy_${userId}` }, { text: "🔓 Открыть кейс", callback_data: `menu_open_${userId}` }]]
                }
            });
        });
    }

    if (text === '/createb') {
        getProfile(userId, (err, p) => {
            if (!p) return;
            if (p.business.hasBusiness) return bot.sendMessage(msg.chat.id, "❌ Бизнес уже создан!");
            if (p.rubles < 500000) return bot.sendMessage(msg.chat.id, "❌ Нужно 500.000 ₽!");
            p.rubles -= 500000;
            p.business = { hasBusiness: true, videoCards: 1, tax: 0, buyTime: Date.now(), lastUpdate: Date.now() };
            db.update({ userId: userId }, p, {}, () => bot.sendMessage(msg.chat.id, "🎉 Бизнес успешно куплен! Инфо: /b"));
        });
    }

    if (text === '/b') {
        getProfile(userId, (err, p) => {
            if (!p || !p.business.hasBusiness) return bot.sendMessage(msg.chat.id, "❌ У вас нет бизнеса. Купить: /createb");
            const nextCardPrice = (p.business.videoCards + 1) * 10000;
            const bInfo = `💼 *Ваш Майнинг Бизнес:*\n\n🖥 Видеокарт: ${p.business.videoCards} / 300 шт.\n📈 Доход в час: ${(p.business.videoCards * 10000).toLocaleString()} ₽\n🧾 Налог: ${p.business.tax.toLocaleString()} / 1.500.000 ₽\n\n💳 Видеокарта стоит: ${nextCardPrice.toLocaleString()} ₽`;
            bot.sendMessage(msg.chat.id, bInfo, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: "🧾 Погасить налог", callback_data: `pay_tax_${userId}` }], [{ text: "🖥 Купить видеокарту", callback_data: `buy_card_${userId}` }]]
                }
            });
        });
    }

    if (text === '/bonus') {
        getProfile(userId, (err, p) => {
            if (!p) return;
            const now = Date.now();
            if (now - p.lastDaily < 24 * 60 * 60 * 1000) return bot.sendMessage(msg.chat.id, `⏳ Ежедневный бонус уже получен!`);
            const casesWon = Math.floor(Math.random() * 4) + 1;
            p.cases.daily += casesWon; p.lastDaily = now;
            db.update({ userId: userId }, p, {}, () => bot.sendMessage(msg.chat.id, `🎁 Вы получили бонус: *${casesWon} шт.* кейсов!`, { parse_mode: 'Markdown' }));
        });
    }

    if (text.startsWith('/trade ')) {
        const targetNick = text.split(' ')[1];
        getProfile(userId, (err, sender) => {
            if (!sender || sender.nickname === targetNick) return;
            db.findOne({ nickname: targetNick }, (err, receiver) => {
                if (!receiver) return bot.sendMessage(msg.chat.id, `❌ Игрок не найден.`);
                activeTrades.set(receiver.userId, { senderId: userId, senderNick: sender.nickname });
                bot.sendMessage(msg.chat.id, `⏳ Запрос отправлен...`);
                bot.sendMessage(receiver.userId, `🤝 Игрок *${sender.nickname}* предлагает вам обмен!`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: "✅ Принять", callback_data: `trade_accept_${receiver.userId}` }, { text: "❌ Отклонить", callback_data: `trade_decline_${receiver.userId}` }]] }
                });
            });
        });
    }

    if (text.startsWith('/casino ')) {
        const bet = parseInt(text.split(' ')[1]);
        if (isNaN(bet) || bet <= 0) return;
        getProfile(userId, (err, p) => {
            if (!p || p.rubles < bet) return bot.sendMessage(msg.chat.id, "❌ Недостаточно рублей!");
            p.casinoGames += 1;
            const win = Math.random() > 0.55;
            if (win) { p.rubles += bet; bot.sendMessage(msg.chat.id, `🎰 Победа! +${bet} ₽.`); } 
            else { p.rubles -= bet; bot.sendMessage(msg.chat.id, `🎰 Проигрыш! -${bet} ₽.`); }
            db.update({ userId: userId }, p, {}, () => {});
        });
    }

    // ==========================================
    // АДМИН-ПАНЕЛЬ РАЗРАБОТЧИКА (@cuqow)
    // ==========================================
    getProfile(userId, (err, currentP) => {
        if (!isAdmin(msg, currentP)) return;

        if (text.startsWith('/giverubles ')) {
            const parts = text.split(' ');
            const targetId = parseInt(parts[1]); const amount = parseInt(parts[2]);
            db.findOne({ gameId: targetId }, (err, target) => {
                if (!target) return;
                target.rubles += amount;
                db.update({ gameId: targetId }, target, {}, () => bot.sendMessage(msg.chat.id, `✅ Выдали ${amount} ₽.`));
            });
        }

        if (text.startsWith('/ungiverubles ')) {
            const parts = text.split(' ');
            const targetId = parseInt(parts[1]); const amount = parseInt(parts[2]);
            db.findOne({ gameId: targetId }, (err, target) => {
                if (!target) return;
                target.rubles -= amount; if (target.rubles < 0) target.rubles = 0;
                db.update({ gameId: targetId }, target, {}, () => bot.sendMessage(msg.chat.id, `✅ Забрали ${amount} ₽.`));
            });
        }

        if (text.startsWith('/newid ')) {
            const parts = text.split(' ');
            const oldId = parseInt(parts[1]); const newId = parseInt(parts[2]);
            db.findOne({ gameId: oldId }, (err, target) => {
                if (!target) return;
                target.gameId = newId;
                db.update({ userId: target.userId }, target, {}, () => bot.sendMessage(msg.chat.id, `✅ ID изменен на ${newId}.`));
            });
        }

        if (text.startsWith('/parentsetadmin ')) {
            const targetId = parseInt(text.split(' ')[1]);
            db.findOne({ gameId: targetId }, (err, target) => {
                if (!target) return;
                target.isAdmin = true;
                db.update({ gameId: targetId }, target, {}, () => bot.sendMessage(msg.chat.id, `👑 Назначен админ.`));
            });
        }

        if (text.startsWith('/giveallcosmetics_id ')) {
            const targetId = parseInt(text.split(' ')[1]);
            db.findOne({ gameId: targetId }, (err, target) => {
                if (!target) return;
                target.inventory.cards = Object.keys(COSMETICS.cards);
                target.inventory.flags = Object.keys(COSMETICS.flags);
                db.update({ gameId: targetId }, target, {}, () => bot.sendMessage(msg.chat.id, `✅ Косметика выдана.`));
            });
        }
    });
});
function openCaseLogic() {
    const rand = Math.random() * 100;
    if (rand <= 0.5) return 100000000; // 0.5% на 100 млн
    if (rand <= 5) return 5000000;
    if (rand <= 20) return 500000;
    if (rand <= 50) return 50000;
    return 1000;
}

// Обработка кликов по кнопкам
bot.on('callback_query', (query) => {
    const userId = query.from.id; const data = query.data;
    if (!data.endsWith(`_${userId}`) && !data.startsWith('trade_')) return;

    getProfile(userId, (err, p) => {
        if (!p) return;

        if (data.startsWith('buy_card_')) {
            if (p.business.videoCards >= 300) return;
            const price = (p.business.videoCards + 1) * 10000;
            if (p.rubles < price) return;
            p.rubles -= price; p.business.videoCards += 1;
            db.update({ userId: userId }, p, {}, () => { bot.sendMessage(userId, `🖥 Видеокарта куплена!`); bot.deleteMessage(query.message.chat.id, query.message.message_id); });
        }

        if (data.startsWith('pay_tax_')) {
            if (p.business.tax <= 0 || p.rubles < p.business.tax) return;
            p.rubles -= p.business.tax; p.business.tax = 0;
            db.update({ userId: userId }, p, {}, () => { bot.sendMessage(userId, `🧾 Налог оплачен!`); bot.deleteMessage(query.message.chat.id, query.message.message_id); });
        }

        if (data.startsWith('inv_cat_cards_')) {
            const buttons = p.inventory.cards.map(cId => [{ text: `${COSMETICS.cards[cId].name}`, callback_data: `equip_card_${cId}_${userId}` }]);
            bot.sendMessage(userId, "Твои карточки профиля:", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data.startsWith('equip_card_')) {
            const cardId = data.split('_')[2]; p.equipped.card = cardId;
            db.update({ userId: userId }, p, {}, () => { bot.sendMessage(userId, `✅ Надета карточка!`); bot.deleteMessage(query.message.chat.id, query.message.message_id); });
        }

        if (data.startsWith('inv_cat_flags_')) {
            const buttons = p.inventory.flags.map(fId => [{ text: `${COSMETICS.flags[fId].name}`, callback_data: `equip_flag_${fId}_${userId}` }]);
            bot.sendMessage(userId, "Твои флаги:", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data.startsWith('equip_flag_')) {
            const flagId = data.split('_')[2]; p.equipped.flag = flagId;
            db.update({ userId: userId }, p, {}, () => { bot.sendMessage(userId, `✅ Флаг установлен!`); bot.deleteMessage(query.message.chat.id, query.message.message_id); });
        }

        if (data.startsWith('menu_buy_')) {
            const opts = { reply_markup: { inline_keyboard: [[{ text: "Бомжа (1k)", callback_data: `buy_b_${userId}` }, { text: "Рабочего (10k)", callback_data: `buy_r_${userId}` }], [{ text: "Бизнесмена (100k)", callback_data: `buy_bz_${userId}` }, { text: "Богача (1M)", callback_data: `buy_bg_${userId}` }], [{ text: "👑 Мажора (10M)", callback_data: `buy_m_${userId}` }]] } };
            bot.sendMessage(userId, "Какой кейс купить?", opts);
        }

        const prices = { 'buy_b_': 1000, 'buy_r_': 10000, 'buy_bz_': 100000, 'buy_bg_': 1000000, 'buy_m_': 10000000 };
        for (let key in prices) {
            if (data.startsWith(key)) {
                if (p.rubles < prices[key]) return;
                p.rubles -= prices[key];
                if (key === 'buy_b_') p.cases.bomzh += 1;
                if (key === 'buy_r_') p.cases.rabochiy += 1;
                if (key === 'buy_bz_') p.cases.biz += 1;
                if (key === 'buy_bg_') p.cases.bogach += 1;
                if (key === 'buy_m_') { p.cases.mazhor += 2; p.cases.bogach += 3; }
                db.update({ userId: userId }, p, {}, () => { bot.sendMessage(userId, `🛍 Кейс куплен!`); bot.deleteMessage(query.message.chat.id, query.message.message_id); });
            }
        }

        if (data.startsWith('menu_open_')) {
            const opts = { reply_markup: { inline_keyboard: [[{ text: "Ежедневный", callback_data: `open_d_${userId}` }, { text: "Бомжа", callback_data: `open_b_${userId}` }], [{ text: "Рабочего", callback_data: `open_r_${userId}` }, { text: "Бизнесмена", callback_data: `open_bz_${userId}` }], [{ text: "Богача", callback_data: `open_bg_${userId}` }, { text: "👑 Мажора", callback_data: `open_m_${userId}` }]] } };
            bot.sendMessage(userId, "Какой кейс открыть?", opts);
        }

        if (data.startsWith('open_d_')) {
            if (p.cases.daily <= 0) return; p.cases.daily -= 1; const m = openCaseLogic(); p.rubles += m;
            db.update({ userId: userId }, p, {}, () => bot.sendMessage(userId, `🔓 Выпало: *${m.toLocaleString()} ₽*`, { parse_mode: 'Markdown' }));
            bot.deleteMessage(query.message.chat.id, query.message.message_id);
        }

        if (data.startsWith('open_bg_')) {
            if (p.cases.bogach <= 0) return; p.cases.bogach -= 1;
            const roll = Math.random(); let prize = "";
            if (roll < 0.15) { if (!p.inventory.flags.includes('ru')) p.inventory.flags.push('ru'); prize = "🇷🇺 Флаг РФ"; } 
            else if (roll < 0.25) { if (!p.inventory.flags.includes('de')) p.inventory.flags.push('de'); prize = "🇩🇪 Флаг Германии"; } 
            else if (roll < 0.35) { if (!p.inventory.flags.includes('us')) p.inventory.flags.push('us'); prize = "🇺🇸 Флаг США"; } 
            else { const cash = Math.floor(Math.random() * 2000000) + 500000; p.rubles += cash; prize = `${cash.toLocaleString()} ₽`; }
            db.update({ userId: userId }, p, {}, () => bot.sendMessage(userId, `🔓 Награда: *${prize}*`, { parse_mode: 'Markdown' }));
            bot.deleteMessage(query.message.chat.id, query.message.message_id);
        }

        if (data.startsWith('open_m_')) {
            if (p.cases.mazhor <= 0) return; p.cases.mazhor -= 1;
            const colors = ['gold', 'diamond', 'emerald', 'azure']; const wonColor = colors[Math.floor(Math.random() * colors.length)];
            if (!p.inventory.cards.includes(wonColor)) p.inventory.cards.push(wonColor);
            const cash = Math.floor(Math.random() * 50000000) + 10000000; p.rubles += cash;
            db.update({ userId: userId }, p, {}, () => bot.sendMessage(userId, `👑 Выигрыш: *${cash.toLocaleString()} ₽* и *${COSMETICS.cards[wonColor].name} карточка*!`, { parse_mode: 'Markdown' }));
            bot.deleteMessage(query.message.chat.id, query.message.message_id);
        }
    });

    if (data.startsWith('trade_accept_')) {
        const rId = parseInt(data.split('_')[2]); if (userId !== rId) return;
        const trade = activeTrades.get(userId); if (!trade) return;
        bot.sendMessage(userId, `✅ Обмен принят!`); bot.sendMessage(trade.senderId, `✅ Обмен принят!`);
        activeTrades.delete(userId); bot.deleteMessage(query.message.chat.id, query.message.message_id);
    }
    if (data.startsWith('trade_decline_')) {
        const rId = parseInt(data.split('_')[2]); if (userId !== rId) return;
        const trade = activeTrades.get(userId); if (trade) bot.sendMessage(trade.senderId, `❌ Обмен отклонен.`);
        activeTrades.delete(userId); bot.deleteMessage(query.message.chat.id, query.message.message_id);
    }
});
