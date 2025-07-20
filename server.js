// ===== Модули, глобальные константы и переменные =====

// npm install fs path readline-sync @google/generative-ai gpt-tokenizer express crypto
const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const tokenizer = require('gpt-tokenizer');
const express = require('express');
const crypto = require('crypto');

// По алфавитному порядку: A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z.
const projectPaths = {
	FILES: {
		// Изменяются или накапливают данные в процессе работы программы — внешние хранилища.
		ACCUMULATED: {
			AUTHENTIFICATION: path.join(__dirname, 'accumulated', 'authentification.json'),
			BLACKLIST: path.join(__dirname, 'accumulated', 'blacklist.json'),
			CHAT: path.join(__dirname, 'accumulated', 'chat.json'),
			HISTORY: path.join(__dirname, 'accumulated', 'history.json'),
			LOG: path.join(__dirname, 'accumulated', 'log.md'),
			MEMORY: path.join(__dirname, 'accumulated', 'memory.md'),
			PARSING_RESULT: path.join(__dirname, 'accumulated', 'parsing_result.txt'),

			TRACKING: {
				FILES: path.join(__dirname, 'accumulated', 'tracking', 'files.json'),
				FOLDERS: path.join(__dirname, 'accumulated', 'tracking', 'folders.json')
			},

			UNFREEZING: {
				LLM: path.join(__dirname, 'accumulated', 'unfreezing', 'llm.json'),
				USER: path.join(__dirname, 'accumulated', 'unfreezing', 'user.json')
			}
		},

		// Файлы не застрахованы от внесения изменений, но служат лишь ради чтения.
		GENERAL: {
			CHARACTER: path.join(__dirname, 'general', 'character.md'),
			SETTINGS: path.join(__dirname, 'general', 'settings.json'),
			INSTRUCTIONS: path.join(__dirname, 'general', 'instructions.md'),
			API_KYES: path.join(__dirname, 'general', 'api_keys.json')
		}
	},

	FOLDERS: {
		WEBSITE: path.join(__dirname, 'website'),
		WORKSPACE: path.join(__dirname, 'workspace')
	}
};

let settings = {
	PROMPT_LIMITS: {
		TOTAL_TOKENS_COUNT: 786432, // 2^(19)×1.5
		
		HISTORY: {
			TURNS: 30,
			TOKENS: 98304 // 2^(16)×1.5
		},
		
		FETCH_URL: {
			BYTES: 2621440, // 2^(20)×2.5
			TOKENS: 196608 // 2^(17)×1.5
		}
	},

	WEBSITE: {
		SERVER_PORT: 3000,
		CLIENT_REFRESH: 3,

		LENGTH_LIMIT: {
			USERNAME: {
				MINIMUM: 3,
				MAXIMUM: 16
			},

			PASSWORD: {
				MINIMUM: 8,
				MAXIMUM: 64
			},

			MESSAGE: 4096
		}
	},

	API_REQUEST: {
		BETWEEN_QUERIES: 90,
		FOR_CASE_OF_FAILURE: 30
	}
};

const listOfCommands = [
	// 📒 Управляемый контекст памяти
	'MemoryAppend',
	'MemoryEdit',
	'MemoryRemove',

	// 🎭 Управление и ведение чата
	'SendMessage',
	'DeleteMessage',
	'Punish',
	'Forgive',
	
	// 🌐 Парсинг сайтов
	'FetchURL',
	'ClearLastURLContent',

	// ⚙️ Управление файловой системой
	'CreateFile',
	'GetFileInfo',
	'TrackFile',
	'ForgetFile',
	'CreateDirectory',
	'TrackDirectory',
	'ForgetDirectory',
	'Delete',
	'Move',
	'Rename',
	'AddToFile',
	'ReplaceInFile',
	'RemoveFromFile',
	'RewriteFile',

	// 💎 Уникальные команды
	'ClearHistory',
	'Wait'
];

const isUsed = {
	SEND_MESSAGE: false,
	FETCH_URL: false,
	CLEAR_LAST_URL_CONTENT: false,
	CLEAR_HISTORY: false,
	WAIT: false
};

let geminiApiKey = null;
let breakMainCycle = false;



// ===== Мелкие вспомогательные функции =====

function finishProcess() {
	breakMainCycle = true;
	readline.question('Программа завершает свою работу. Нажмите «Enter» для выхода…');
	process.exit();
}

function setConsoleTitle(name) {
	process.stdout.write(`\x1b]0;${name}\x07`);
}

function getTimestamp() {
	const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
	return new Intl.DateTimeFormat('ru-RU', options).format(new Date());
}

function simplificationNumeral(number) {
	if (number > 19 && number < 100) {
		return number % 10;
	}
	if (number > 99) {
		number = number % 100;
		if (number > 19 && number < 100) {
			return number % 10;
		}
	}
	return number;
}

/**
 * Спрягает существительное с числительным.
 * @param {Number} number Число, с которым будет спрягаться существительное.
 * @param {String} foundation Неизменяемая часть слова.
 * @param {String} additionOne Продолжение слова, которое будет использовано, когда число равно 0 или больше 4.
 * @param {String} additionTwo Продолжение слова, которое будет использовано, когда число равно 1.
 * @param {String} additionThree Продолжение слова, которое будет использовано, когда число равно 2, 3 или 4.
 */
function matchWord(number, foundation, additionOne, additionTwo, additionThree) {
	number = simplificationNumeral(number);
	if (number == 0 || number > 4) {
		return foundation + additionOne;
	}
	if (number == 1) {
		return foundation + additionTwo;
	}
	return foundation + additionThree;
}

function getSha256Hash(stringValue) {
	const hash = crypto.createHash('sha256');
	hash.update(stringValue, 'utf8');
	return hash.digest('hex');
}

/**
 * Рекурсивно извлекает все строковые значения из вложенного объекта.
 * @param {object} structure Объект для обхода.
 * @returns {string[]} Массив всех найденных строковых значений.
 */
function getAllStringValues(structure) {
    // Метод flatMap позволяет обойти значения объекта с автоматическим "разглаживанием" вложенных массивов.
    return Object.values(structure).flatMap(value => {
        if (typeof value === 'string') {
			return value;
		} else if (typeof value === 'object' && value !== null) {
			return getAllStringValues(value);
		}
        return []; // Игнорирование других типов данных.
    });
}

const allProjectPaths = getAllStringValues(projectPaths);

function testForProjectPath(objectPath) {
	if (!allProjectPaths.includes(objectPath)) {
		console.error(`Переданный путь «${path.relative(__dirname, objectPath)}» не относится к проекту.`);
		finishProcess();
	}
}

function writeIntoFile(objectPath, content) {
	fs.mkdirSync(path.dirname(objectPath), { recursive: true });
	fs.writeFileSync(objectPath, content, 'utf-8');
}

function appendIntoFile(objectPath, content) {
	fs.mkdirSync(path.dirname(objectPath), { recursive: true });
	fs.appendFileSync(objectPath, content, 'utf-8');
}

function stripHtmlTags(html) {
	let result = html;
	result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
	result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
	result = result.replace(/<!--[\s\S]*?-->/g, '');
	result = result.replace(/<a[^>]*?href=["']([^"']*)["'][^>]*?>(.*?)<\/a>/gis, (match, href, linkText) => {
		const cleanedLinkText = linkText.replace(/<[^>]*>/g, '');
		return cleanedLinkText.trim() ? `${cleanedLinkText.trim()} (${href})` : `(${href})`;
	});
	result = result.replace(/<[^>]*>/g, '');
	result = result.replace(/ /g, ' ');
	result = result.replace(/&/g, '&');
	result = result.replace(/</g, '<');
	result = result.replace(/>/g, '>');
	result = result.replace(/"/g, '"');
	result = result.replace(/&#(\d+);/g, (match, code) => String.fromCharCode(parseInt(code, 10)));
	result = result.replace(/&#x([0-9A-Fa-f]+);/g, (match, code) => String.fromCharCode(parseInt(code, 16)));
	result = result.replace(/\s{2,}/g, ' ');
	result = result.replace(/\n\s*\n/g, '\n\n');
	return result.trim();
}

function formatErrorMessage(error) {
    return error.message.replace(/\s+/g, ' ').trim();
}

function checkWorkspaceFolderExistence() {
	const projectObject = projectPaths.FOLDERS.WORKSPACE;
	if (!fs.existsSync(projectObject)) {
		fs.mkdirSync(projectObject, { recursive: true });
		console.log('Создана пустая рабочая директория станции.');
	}
}



// ===== Переопределение методов консоли =====

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = function(message) {
	const record = `[LOG] [${getTimestamp()}] ${message}`;
	originalConsoleLog(record);
	try {
		appendIntoFile(projectPaths.FILES.ACCUMULATED.LOG, record + '\n');
	} catch (error) {
		originalConsoleError(`Существует проблема, мешающая вести файл лога → ${formatErrorMessage(error)}`);
		finishProcess();
	}
};
console.error = function(message) {
	const record = `[ERROR] [${getTimestamp()}] ${message}`;
	originalConsoleError(record);
	try {
		appendIntoFile(projectPaths.FILES.ACCUMULATED.LOG, record + '\n');
	} catch (error) {
		originalConsoleError(`Существует проблема, мешающая вести файл лога → ${formatErrorMessage(error)}`);
		finishProcess();
	}
};



// ===== Валидация текстового файла и получение его содержимого =====

function binaryFileExpectation(filePath) {
	const fileBuffer = fs.readFileSync(filePath);
	let isBinary = false;
	let fileContent;
	try {
		fileContent = fileBuffer.toString('utf-8');
		if (fileBuffer.some(byte => byte === 0)) {
			isBinary = true;
			fileContent = null;
		}
	} catch (error) {
		isBinary = true;
		fileContent = null;
	}
	return [isBinary, fileContent];
}

function validateFileAndGetText(objectPath) {
	if (!fs.existsSync(objectPath)) {
		throw new Error('Объект по указанному пути не был найден.');
	}
	const stats = fs.statSync(objectPath);
	if (!stats.isFile()) {
		throw new Error('Указанный путь ведёт к объекту, который не является файлом.');
	}
	const [isBinary, fileContent] = binaryFileExpectation(objectPath);
	if (isBinary) {
		throw new Error('Файл является бинарным и не может быть прочитан как текст.');
	}
	return fileContent;
}



// ===== Проверка и чтение файлов проекта =====

function readProjectFileContent(objectPath, designation, couldBeEmpty) {
	testForProjectPath(objectPath);
	let fileContent = '';
	try {
		let didFileExist = false;

		if (!fs.existsSync(objectPath)) {
			writeIntoFile(objectPath, '');
			const feedback = `Создан пустой файл ${designation}.`;
			if (!couldBeEmpty) {
				console.error(`${feedback} Его необходимо заполнить.`);
				finishProcess();
			}
			console.log(feedback);
		} else {
			didFileExist = true;
		}

		if (didFileExist) {
			fileContent = validateFileAndGetText(objectPath);
			if (!couldBeEmpty && fileContent === '') {
				console.error(`Файл ${designation} не может быть пустым.`);
				finishProcess();
			}
		}
	} catch (error) {
		console.error(`Произошла ошибка во время чтения файла ${designation} → ${formatErrorMessage(error)}`);
		try {
			writeIntoFile(objectPath, '');
		} catch (exception) {
			finishProcess();
		}
	}
	return fileContent;
}

function readArrayFromProjectFile(objectPath) {
	testForProjectPath(objectPath);
	let collection = [];
	try {
		if (!fs.existsSync(objectPath)) {
			writeIntoFile(objectPath, JSON.stringify([]));
			console.log(`Был создан файл «${path.relative(__dirname, objectPath)}» с пустым массивом.`);
		} else {
			const parsedContent = JSON.parse(validateFileAndGetText(objectPath));
			if (Array.isArray(parsedContent)) {
				collection = parsedContent;
			} else {
				console.error(`Содержимое файла «${path.relative(__dirname, objectPath)}» не является массивом — он будет пересоздан.`);
				writeIntoFile(objectPath, JSON.stringify([]));
			}
		}
	} catch (error) {
		console.error(`Неудачная попытка чтения массива из файла «${path.relative(__dirname, objectPath)}» → ${formatErrorMessage(error)}`);
		try {
			writeIntoFile(objectPath, JSON.stringify([]));
		} catch (exception) {
			finishProcess();
		}
	}
	return collection;
}



// ===== Многозадачные взаимодействия с историей =====

function validateHistoryAndGetArray() {
	const projectObject = projectPaths.FILES.ACCUMULATED.HISTORY;
	const collection = readArrayFromProjectFile(projectObject);
	if (collection.length === 0) {
		return [];
	}
	if (
		!collection.every(structure => typeof structure.TIMESTAMP === 'string') ||
		!collection.every(structure => typeof structure.CONTENT === 'string')
	) {
		console.error('Найдена ошибка в структуре элемента файла истории — будет произведена перезапись подчистую.');
		writeIntoFile(projectObject, JSON.stringify([]));
		return [];
	}
	return collection;
}

function updateHistory(content) {
	let collection = validateHistoryAndGetArray();
	try {
		collection.push({
			TIMESTAMP: getTimestamp(),
			CONTENT: content
		});
		const turns = settings.PROMPT_LIMITS.HISTORY.TURNS;
		// Метод slice копирует указанный диапазон элементов исходного массива в новый массив, при этом исходный массив не изменяется. Первый параметр — индекс, начиная с которого идёт копирование, второй — индекс, до которого следует копировать (НЕ включает элемент под этим индексом).
		if (collection.length > turns) {
			collection = collection.slice(1, turns + 1);
		}
		writeIntoFile(projectPaths.FILES.ACCUMULATED.HISTORY, JSON.stringify(collection, null, '\t'));
	} catch (error) {
		console.error(`Не удалось обновить массив файла истории → ${formatErrorMessage(error)}`);
		finishProcess();
	}
}

function formHistoryContent() {
	const collection = validateHistoryAndGetArray();
	try {
		const prepared = [];
		if (collection.length === 1) {
			prepared.push(`[${collection[0].TIMESTAMP}] → {\n${collection[0].CONTENT}\n}`);
		} else {
			for (let elementNumber = 1; elementNumber <= collection.length; elementNumber++) {
				prepared.push(`${elementNumber}. [${collection[elementNumber - 1].TIMESTAMP}] → {\n${collection[elementNumber - 1].CONTENT}\n}`);
			}
		}

		const result = [];
		let complete = false;
		let remainingTokensCount = settings.PROMPT_LIMITS.HISTORY.TOKENS;
		for (let elementIndex = prepared.length - 1; elementIndex > -1 && !complete; elementIndex--) {
			const record = prepared[elementIndex];
			const requiredAmount = tokenizer.encode(record).length;
			if (requiredAmount <= remainingTokensCount) {
				result.unshift(record);
				remainingTokensCount -= requiredAmount;
			} else {
				complete = true;
			}
		}
		return result.join('\n\n');
	} catch (error) {
		console.error(`Не получилось сформировать текстовое содержимое файла истории → ${formatErrorMessage(error)}`);
		finishProcess();
	}
}



// ===== Многозадачные взаимодействия с чатом =====

function validateChatAndGetArray() {
	const projectObject = projectPaths.FILES.ACCUMULATED.CHAT;
	const collection = readArrayFromProjectFile(projectObject);
	if (collection.length === 0) {
		return [];
	}
	if (
		!collection.every(structure => typeof structure.TIMESTAMP === 'string') ||
		!collection.every(structure => typeof structure.NICKNAME === 'string') ||
		!collection.every(structure => typeof structure.ROLE === 'string') ||
		!collection.every(structure => typeof structure.IDENTIFIER === 'number') ||
		!collection.every(structure => typeof structure.CONTENT === 'string')
	) {
		console.error('Найдена ошибка в структуре элемента файла чата — будет произведена перезапись подчистую.');
		writeIntoFile(projectObject, JSON.stringify([]));
		return [];
	}
	return collection;
}

function generateMessageIdentifier() {
	const collection = validateChatAndGetArray();
	if (collection.length === 0) {
		return 1;
	}
	const existingIdentifiers = new Set(collection.map(structure => structure.IDENTIFIER));
	let maximumValue = 0;
	for (let currentValue of existingIdentifiers) {
		if (currentValue > maximumValue) {
			maximumValue = currentValue;
		}
	}
	return maximumValue + 1;
}

function pushChatMessage(nickname, content, role, ipAddress) {
	const collection = validateChatAndGetArray();
	try {
		const newStructure = {
			TIMESTAMP: getTimestamp(),
			NICKNAME: nickname,
			ROLE: role,
			IDENTIFIER: generateMessageIdentifier(),
			CONTENT: content
		};
		if (ipAddress !== null) {
			newStructure.IP_ADDRESS = ipAddress;
		}
		collection.push(newStructure);

		writeIntoFile(projectPaths.FILES.ACCUMULATED.CHAT, JSON.stringify(collection, null, '\t'));
		let result = `Сообщение от <${nickname}> (${role}) [Идентификатор сообщения: «${newStructure.IDENTIFIER}»]`;
		const ipPart = ipAddress !== null ? `[IP-адрес: «${ipAddress}»]` : '';
		if (ipPart !== '') {
			result = `${result} ${ipPart} внесено в чат.`;
		}
		return [true, result];
	} catch (error) {
		return [false, `Не удалось внести сообщение в чат → ${formatErrorMessage(error)}`];
	}
}

function deleteChatMessage(identifier) {
	const initial = validateChatAndGetArray();
	const updated = initial.filter(structure => structure.IDENTIFIER !== identifier);

	let feedback = `Сообщение с идентификатором «${identifier}»`;
	if (updated.length < initial.length) {
		try {
			writeIntoFile(projectPaths.FILES.ACCUMULATED.CHAT, JSON.stringify(updated, null, '\t'));
			return [true, `${feedback} удалено из чата.`];
		} catch (error) {
			return [false, `${feedback} не удалось удалить из чата → ${formatErrorMessage(error)}`];
		}
	} else {
		return [false, `${feedback} не найдено в чате.`];
	}
}

function formChatContent(isIpPartRequired) {
	const collection = validateChatAndGetArray();
	if (collection.length === 0) {
		return '';
	}
	return collection.map(structure => {
		let result = `[${structure.TIMESTAMP}] <${structure.NICKNAME}> (${structure.ROLE}) [Идентификатор сообщения: «${structure.IDENTIFIER}»]`;
		if (isIpPartRequired) {
			const ipPart = structure.IP_ADDRESS ? `[IP-адрес: «${structure.IP_ADDRESS}»]` : '';
			if (ipPart !== '') result = `${result} ${ipPart}`;
		}
		return `${result} → {\n${structure.CONTENT}\n}`;
	}).join('\n\n');
}



// ===== Аутентификация пользователей =====

function validateAuthentificationAndGetArray() {
	const projectObject = projectPaths.FILES.ACCUMULATED.AUTHENTIFICATION;
	const collection = readArrayFromProjectFile(projectObject);
	if (collection.length === 0) {
		return [];
	}
	if (
		!collection.every(structure => typeof structure.USERNAME === 'string') ||
		!collection.every(structure => typeof structure.HASHCODE === 'string')
	) {
		console.error('Найдена ошибка в структуре элемента файла авторизации пользователей — будет произведена перезапись подчистую.');
		writeIntoFile(projectObject, JSON.stringify([]));
		return [];
	}
	return collection;
}

/**
 * Проверяет или регистрирует пользователя.
 * @param {string} username Имя пользователя.
 * @param {string} passwordHash SHA-256 хэш пароля.
 * @returns {boolean} true если пользователь успешно авторизован или зарегистрирован, false иначе.
 */
function authenticateUser(username, passwordHash) {
	const collection = validateAuthentificationAndGetArray();
	const existingUser = collection.find(structure => structure.USERNAME === username);

	try {
		if (!existingUser) {
			// Пользователь не существует, регистрируем нового
			collection.push({ USERNAME: username, HASHCODE: passwordHash });
			writeIntoFile(projectPaths.FILES.ACCUMULATED.AUTHENTIFICATION, JSON.stringify(collection, null, '\t'));
			console.log(`Новый пользователь «${username}» успешно зарегистрирован.`);
			return true;
		} else {
			// Пользователь существует, проверяем пароль
			if (existingUser.HASHCODE === passwordHash) {
				return true;
			} else {
				console.log(`Пользователь «${username}» попытался войти с неверным паролем.`);
				return false;
			}
		}
	} catch (error) {
		console.error(`Ошибка при работе с файлом авторизации пользователей → ${formatErrorMessage(error)}`);
		return false;
	}
}



// ===== Многозадачные обработчики чёрного списка =====

function validateBlacklistAndGetArray() {
	const projectObject = projectPaths.FILES.ACCUMULATED.BLACKLIST;
	const collection = readArrayFromProjectFile(projectObject);
	if (
		!collection.every(structure => typeof structure.TIMESTAMP === 'string') ||
		!collection.every(structure => typeof structure.USERNAME === 'string') ||
		!collection.every(structure => typeof structure.IP_ADDRESS === 'string') ||
		!collection.every(structure => typeof structure.REASON === 'string')
	) {
		console.error('Найдена ошибка в структуре элемента файла чёрного списка — будет произведена перезапись подчистую.');
		writeIntoFile(projectObject, JSON.stringify([]));
		return [];
	}
	return collection;
}

function pushIntoBlacklist(username, ipAddress, reason) {
	const collection = validateBlacklistAndGetArray();
	try {
		if (collection.some(structure => structure.USERNAME === username)) {
			return 'Это имя пользователя уже заблокировано.'
		} else if (collection.some(structure => structure.IP_ADDRESS === ipAddress)) {
			return 'Указанный IP-адрес уже находится в чёрном списке.';
		}
		collection.push({
			TIMESTAMP: getTimestamp(),
			USERNAME: username,
			IP_ADDRESS: ipAddress,
			REASON: reason
		});
		writeIntoFile(projectPaths.FILES.ACCUMULATED.BLACKLIST, JSON.stringify(collection, null, '\t'));
		return 'Имя пользователя заблокировано и запрещён IP-адрес.';
	} catch (error) {
		return `Не удалось обновить чёрный список → ${formatErrorMessage(error)}`;
	}
}

function deleteFromBlacklist(ipAddress) {
	const initial = validateBlacklistAndGetArray();
	const updated = initial.filter(structure => structure.IP_ADDRESS !== ipAddress);

	let feedback = `Запись с IP-адресом «${ipAddress}»`;
	if (updated.length < initial.length) {
		try {
			writeIntoFile(projectPaths.FILES.ACCUMULATED.BLACKLIST, JSON.stringify(updated, null, '\t'));
			return [true, `${feedback} удалена из чёрного списка.`];
		} catch (error) {
			return [false, `${feedback} не удалось стереть → ${formatErrorMessage(error)}`];
		}
	} else {
		return [false, `${feedback} не найдена.`];
	}
}

function formBlacklistContent() {
	const collection = validateBlacklistAndGetArray();
	if (collection.length === 0) {
		return '';
	}
	return collection.map(structure => {
		return `[${structure.TIMESTAMP}] Принадлежит пользователю: «${structure.USERNAME}» [IP-адрес: «${structure.IP_ADDRESS}»] Причина блокировки → {\n${structure.REASON}\n}`;
	}).join('\n\n');
}



// ===== Формирование текстового представления отслеживаемых объектов файловой системы =====

function checkDirectoryAndGetVisualization(objectPath) {
	if (!fs.existsSync(objectPath)) {
		throw new Error('Объект по указанному пути не был найден.');
	}
	const stats = fs.statSync(objectPath);
	if (!stats.isDirectory()) {
		throw new Error('Указанный путь ведёт к объекту, который не является каталогом.');
	}

	const objects = fs.readdirSync(objectPath, { withFileTypes: true });
	const sortedObjects = objects.sort((firstObject, secondObject) => {
		if (firstObject.isDirectory() && !secondObject.isDirectory()) {
			return -1;
		}
		if (!firstObject.isDirectory() && secondObject.isDirectory()) {
			return 1;
		}
		return firstObject.name.localeCompare(secondObject.name);
	});

	const result = sortedObjects.map(object => {
		if (object.isDirectory()) {
			return `[DIRECTORY] ${object.name}`;
		} else if (object.isFile()) {
			return `[FILE] ${object.name}`;
		}
		return `[OTHER] ${object.name}`;
	}).join('\n');

	if (result.length === 0) {
		return `Директория «${objectPath}» пуста.`;
	} else {
		return `Содержимое директории «${objectPath}» → {\n${result}\n}`;
	}
}

/**
 * Автоматизирует валидацию и сбор отслеживаемых данных.
 * @param {string} projectObject Путь до хранилища массива отслеживаемых путей, являющегося частью проекта.
 * @param {Function} processor Функция, служащая для формирование текстового представления объектов файловой системы.
 * @param {string} designation Словосочетание, которое должно подходящим образом встать на пропущенное место.
 * @returns {string[]} Проверенный, готовый и актуальный строковый информационный контент.
 */
function reviseTrackedPathsAndCollectData(projectObject, processor, designation) {
	const initial = readArrayFromProjectFile(projectObject);
	const contentArray = [];
	if (!initial.every(elementValue => typeof elementValue === 'string')) {
		writeIntoFile(projectObject, JSON.stringify([]));
	} else {
		let updated = [];
		for (let objectPath of initial) {
			try {
				if (!path.resolve(objectPath).startsWith(projectPaths.FOLDERS.WORKSPACE)) {
					throw new Error('Нельзя получить данные за пределами рабочего каталога.');
				}
				contentArray.push(processor(objectPath));
				updated.push(objectPath);
			} catch (exception) {
				console.error(`Был сброшен путь до ${designation}: «${objectPath}» → ${formatErrorMessage(exception)}.`);
			}
		}
		if (initial.length !== updated.length) {
			writeIntoFile(projectObject, JSON.stringify(updated, null, '\t'));
		}
	}
	return contentArray;
}

function formTrackingContent() {
	try {
		const filesContentArray = reviseTrackedPathsAndCollectData (
			projectPaths.FILES.ACCUMULATED.TRACKING.FILES,
			(objectPath) => `Содержимое файла «${objectPath}» →{\n${validateFileAndGetText(objectPath)}\n}`,
			'отслеживаемого файла'
		);
		const directoriesContentArray = reviseTrackedPathsAndCollectData (
			projectPaths.FILES.ACCUMULATED.TRACKING.FOLDERS,
			(objectPath) => checkDirectoryAndGetVisualization(objectPath),
			'отслеживаемой директории'
		);

		let result = [];
		if (filesContentArray.length !== 0) {
			result.push(`=== Отслеживаемые на текущий момент файлы ===\n\n${filesContentArray.join('\n\n')}`);
		}
		if (directoriesContentArray.length !== 0) {
			result.push(`=== Отслеживаемые на текущий момент директории ===\n\n${directoriesContentArray.join('\n\n')}`);
		}
		return result.join('\n\n');
	} catch (error) {
		console.error(`Отслеживаемые данные не были собраны → ${formatErrorMessage(error)}`);
		finishProcess();
	}
}



// ===== Чтение и запись меток времени =====

function readTimestampFromProjectStorage(objectPath) {
	let fileContent = readProjectFileContent(objectPath, 'хранилища отметки времени разморозки', true);
	let timestamp = 0;
	try {
		if (fileContent === '') {
			writeIntoFile(objectPath, JSON.stringify(0));
			console.log(`Файл «${path.relative(__dirname, objectPath)}» был пуст, поэтому в него записана нулевая отметка времени.`);
		} else {
			const parsedContent = JSON.parse(fileContent);
			if (typeof parsedContent === 'number' && Number.isInteger(parsedContent)) {
				timestamp = parsedContent;
			} else {
				console.error(`Содержимое файла «${path.relative(__dirname, objectPath)}» не является целым числом — он будет пересоздан с нулевой отметкой.`);
				writeIntoFile(objectPath, JSON.stringify(0));
			}
		}
	} catch (error) {
		console.error(`Прочитать метку времени из файла «${path.relative(__dirname, objectPath)}» не вышло → ${formatErrorMessage(error)}`);
		finishProcess();
	}
	return timestamp;
}

function writeTimestampIntoProjectStorage(filePath, timestamp) {
	testForProjectPath(filePath);
	try {
		if (typeof timestamp !== 'number' || !Number.isInteger(timestamp)) {
			throw new Error('Отметка времени должна быть целым числом.');
		}
		writeIntoFile(filePath, JSON.stringify(timestamp));
	} catch (error) {
		console.error(`Не удалось записать отметку времени в файл «${path.relative(__dirname, filePath)}» → ${formatErrorMessage(error)}`);
		finishProcess();
	}
}



// ===== Валидаторы значений полей для структур =====

// Если проверка возвращает ничего, тогда проблема отсутствует.

function checkNotEmptyStringField(content, designation) {
	let feedback = null;
	if (content === null) feedback = `Поле с ${designation} отсутствует.`;
	else if (typeof content !== 'string' || content === '') feedback = `Поле с ${designation} должно быть непустой строкой.`;
	return feedback;
}

function checkIntegerField(content, designation) {
	let feedback = null;
	if (content === null) feedback = `Поле с ${designation} отсутствует.`;
	else if (typeof content !== 'number' || !Number.isInteger(content)) feedback = `Значение поля с ${designation} не является целым числом.`;
	return feedback;
}

function checkNaturalNumberField(content, designation) {
	let feedback = checkIntegerField(content, designation);
	if (feedback !== null || content <= 0) feedback = `Значение поля с ${designation} не является натуральным числом.`;
	return feedback;
}

function checkPortNumber(content, designation) {
	let feedback = checkIntegerField(content, designation);
	if (feedback !== null || content < 0 || content > 65535) feedback = `Значение поля не является ${designation}.`;
	return feedback;
}



// ===== Загрузка и проверка данных из статических файлов проекта =====

function checkApiKeysAndGetArray() {
	const projectObject = projectPaths.FILES.GENERAL.API_KYES;
	const collection = readArrayFromProjectFile(projectObject);
	if (collection.length === 0) {
		console.error(`Ни один ключ от Gemini API не указан.`);
		finishProcess();
	}
	if (!collection.every(elementValue => typeof elementValue === 'string')) {
		console.error('Обнаружена ошибка в хранилище ключей от Gemini API — будет произведена перезапись подчистую.');
		writeIntoFile(projectObject, JSON.stringify([]));
		finishProcess();
	}
	return collection;
}

function exceptApiKey(existingValue) {
	const initial = checkApiKeysAndGetArray();
	const updated = initial.filter(elementValue => elementValue !== existingValue);
	writeIntoFile(projectPaths.FILES.GENERAL.API_KYES, JSON.stringify(updated, null, '\t'));
}

function tryChangeApiKey(currentValue) {
	const collection = checkApiKeysAndGetArray();
	if (collection.length > 1) {
		const currentIndex = collection.indexOf(currentValue);
		if (currentIndex === -1 || currentIndex === collection.length - 1) {
			return collection[0];
		} else {
			return collection[currentIndex + 1];
		}
	} else {
		return currentValue;
	}
}

function readSettings() {
	try {
		const projectObject = projectPaths.FILES.GENERAL.SETTINGS;
		if (!fs.existsSync(projectObject)) {
			writeIntoFile(projectObject, JSON.stringify(settings, null, '\t'));
			console.log('Файл настроек проекта не найден — создан шаблон по умолчанию.');
		} else {
			settings = JSON.parse(readProjectFileContent(projectObject, 'с настройками программы', false)); 
		}

		let result;
		let errors = [];
		let givenValue;

		givenValue = settings.PROMPT_LIMITS.TOTAL_TOKENS_COUNT;
		result = checkNaturalNumberField(givenValue, 'числом токенов, ограничивающим длину промпта,');
		if (result !== null) {
			errors.push(result);
		} else if (givenValue < 524288) {
			errors.push('Недостаточный предел числа токенов в промпте');
		}

		givenValue = settings.PROMPT_LIMITS.HISTORY.TURNS;
		result = checkNaturalNumberField(givenValue, 'количеством ходов по содержимому истории');
		if (result !== null) {
			errors.push(result);
		}

		givenValue = settings.PROMPT_LIMITS.HISTORY.TOKENS;
		result = checkNaturalNumberField(givenValue, 'числом токенов, определяющим рамки количества ходов истории,');
		if (result !== null) {
			errors.push(result);
		} else if (givenValue > 524288) {
			errors.push('Нельзя уделять для истории столь большой запас токенов.');
		} else if (givenValue < 1024 * settings.PROMPT_LIMITS.HISTORY.TURNS) {
			errors.push('Указано слишком маленькое число токенов для блока истории.');
		}

		givenValue = settings.PROMPT_LIMITS.FETCH_URL.BYTES;
		result = checkNaturalNumberField(givenValue, 'лимитом загружаемых байтов для URL-контента');
		if (result !== null) {
			errors.push(result);
		} else if (givenValue < 524288) {
			errors.push('Лимит байтов для URL-контента слишком мал.');
		}

		givenValue = settings.PROMPT_LIMITS.FETCH_URL.TOKENS;
		result = checkNaturalNumberField(givenValue, 'ограничением по токенам результата парсинга сайта');
		if (result !== null) {
			errors.push(result);
		} else if (givenValue < 4096) {
			errors.push('Ограничение по токенам результата парсинга сайта слишком грубое.');
		}

		givenValue = settings.WEBSITE.SERVER_PORT;
		result = checkPortNumber(givenValue, 'портом веб-сервера');
		if (result !== null) {
			errors.push(result);
		}

		givenValue = settings.WEBSITE.CLIENT_REFRESH;
		result = checkNaturalNumberField(givenValue, 'интервалом обновления чата на клиенте');
		if (result !== null) {
			errors.push(result);
		}

		givenValue = settings.WEBSITE.LENGTH_LIMIT.USERNAME.MINIMUM;
		result = checkNaturalNumberField(givenValue, 'минимальной длиной имени пользователя');
		if (result !== null) {
			errors.push(result);
		}

		givenValue = settings.WEBSITE.LENGTH_LIMIT.USERNAME.MAXIMUM;
		result = checkNaturalNumberField(givenValue, 'максимальной длиной имени пользователя');
		if (result !== null) {
			errors.push(result);
		} else if (givenValue < settings.WEBSITE.LENGTH_LIMIT.USERNAME.MINIMUM) {
			errors.push('Максимальная длина имени пользователя не может быть меньше минимальной.');
		}

		givenValue = settings.WEBSITE.LENGTH_LIMIT.PASSWORD.MINIMUM;
		result = checkNaturalNumberField(givenValue, 'минимальной длиной пароля');
		if (result !== null) {
			errors.push(result);
		}

		givenValue = settings.WEBSITE.LENGTH_LIMIT.PASSWORD.MAXIMUM;
		result = checkNaturalNumberField(givenValue, 'максимальной длиной пароля');
		if (result !== null) {
			errors.push(result);
		} else if (givenValue < settings.WEBSITE.LENGTH_LIMIT.PASSWORD.MINIMUM) {
			errors.push('Максимальная длина пароля не может быть меньше минимальной.');
		}

		givenValue = settings.WEBSITE.LENGTH_LIMIT.MESSAGE;
		result = checkNaturalNumberField(givenValue, 'максимальной длиной сообщения');
		if (result !== null) {
			errors.push(result);
		}

		givenValue = settings.API_REQUEST.BETWEEN_QUERIES;
		result = checkNaturalNumberField(givenValue, 'таймером отката для последующего запроса');
		if (result !== null) {
			errors.push(result);
		}

		givenValue = settings.API_REQUEST.FOR_CASE_OF_FAILURE;
		result = checkNaturalNumberField(givenValue, 'таймером задержки в случае возникновения ошибки');
		if (result !== null) {
			errors.push(result);
		}

		if (errors.length > 0) {
			throw new Error(errors.join(' '));
		}
	} catch (error) {
		console.error(`Произошла ошибка во время работы с файлом настроек → ${formatErrorMessage(error)}`);
		finishProcess();
	}
}

readSettings();



// ===== Веб-сервер для функционирования онлайн-чата =====

const application = express();
application.use(express.json());
application.use(express.static(projectPaths.FOLDERS.WEBSITE));

application.get('/hashcode', (request, response) => {
	try {
		response.json({
			SUCCESS: true,
			HASHCODE: getSha256Hash(formChatContent(false))
		});
	} catch (error) {
		console.error(`Случилась ошибка при попытки отправить хэш-код → ${formatErrorMessage(error)}`);
		response.status(500).json({
			SUCCESS: false
		});
	}
});

application.get('/chat', (request, response) => {
	try {
		response.json({
			SUCCESS: true,
			CHAT: formChatContent(false)
		});
	} catch (error) {
		console.error(`Не вышло переслать содержание чата пользовательскому интерфейсу → ${formatErrorMessage(error)}`);
		response.status(500).json({
			SUCCESS: false,
			MESSAGE: 'На сервере произошла ошибка, из-за которой не удалось загрузить чат.'
		});
	}
});

application.get('/settings', (request, response) => {
	try {
		response.json({
			SUCCESS: true,
			CLIENT_REFRESH: settings.WEBSITE.CLIENT_REFRESH,
			LENGTH_LIMIT: {
				USERNAME: {
					MINIMUM: settings.WEBSITE.LENGTH_LIMIT.USERNAME.MINIMUM,
					MAXIMUM: settings.WEBSITE.LENGTH_LIMIT.USERNAME.MAXIMUM
				},
				PASSWORD: {
					MINIMUM: settings.WEBSITE.LENGTH_LIMIT.PASSWORD.MINIMUM,
					MAXIMUM: settings.WEBSITE.LENGTH_LIMIT.PASSWORD.MAXIMUM
				},
				MESSAGE: settings.WEBSITE.LENGTH_LIMIT.MESSAGE
			}
		});
	} catch (error) {
		console.error(`Ошибка предоставления настроек клиенту → ${formatErrorMessage(error)}`);
		response.status(500).json({
			SUCCESS: false,
			MESSAGE: 'На сервере произошла ошибка, из-за которой не удалось отправить сведения о настройках.'
		});
	}
});

application.post('/message', async (request, response) => {
	try {
		const userUnfreezingTimestamp = readTimestampFromProjectStorage(projectPaths.FILES.ACCUMULATED.UNFREEZING.USER);
		if (Date.now() < userUnfreezingTimestamp) {
			const remainingSeconds = Math.ceil((userUnfreezingTimestamp - Date.now()) / 1000);
			return response.status(429).json({
				SUCCESS: false,
				MESSAGE: `Пожалуйста, подождите ${remainingSeconds} ${matchWord(remainingSeconds, 'секунд', '', 'у', 'ы')} перед отправкой нового сообщения.`
			});
		}

		let { username, password, message } = request.body;
		username = username.replace(/\s+/g, ' ').trim();
		password = password.trim();
		message = message.trim();
		const ipAddress = request.ip;

		const blacklist = validateBlacklistAndGetArray();
		let rejectionReason = 'Вы не можете отправлять сообщения.';
		let preventAction = false;
		if (blacklist.some(structure => structure.USERNAME === username)) {
			preventAction = true;
			rejectionReason += ' Этот пользователь забанен.'
		} else if (blacklist.some(structure => structure.IP_ADDRESS === ipAddress)) {
			preventAction = true;
			rejectionReason += ' Ваш IP-адрес заблокирован.'
		}
		if (preventAction) {
			console.log(`Отказ входящего сообщения от пользователя «${username}» с IP-адреса «${ipAddress}»: «${rejectionReason}».`);
			return response.status(403).json({
				SUCCESS: false,
				MESSAGE: rejectionReason
			});
		}

		const availableUsernameSymbols = /^[a-zA-Zа-яА-Я0-9_ ]+$/;
		const minimumUsernameLength = settings.WEBSITE.LENGTH_LIMIT.USERNAME.MINIMUM;
		const maximumUsernameLength = settings.WEBSITE.LENGTH_LIMIT.USERNAME.MAXIMUM;
		const availablePasswordSymbols = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+$/;
		const minimumPasswordLength = settings.WEBSITE.LENGTH_LIMIT.PASSWORD.MINIMUM;
		const maximumPasswordLength = settings.WEBSITE.LENGTH_LIMIT.PASSWORD.MAXIMUM;
		const limitMessageLength = settings.WEBSITE.LENGTH_LIMIT.MESSAGE;
		const validationErrors = [];

		if (!username || typeof username !== 'string' || username.length === 0) {
			validationErrors.push('Имя пользователя не может быть пустым.');
		} else if (!availableUsernameSymbols.test(username)) {
			validationErrors.push('Имя пользователя может содержать только буквы русского и английского алфавита, нижнее подчёркивание, пробел и цифры.');
		} else if (username.length < minimumUsernameLength) {
			validationErrors.push(`Имя пользователя должно содержать не менее ${minimumUsernameLength} ${matchWord(minimumUsernameLength, 'символ', 'ов', '', 'а')}.`);
		} else if (username.length > maximumUsernameLength) {
			validationErrors.push(`Имя пользователя должно содержать не более ${maximumUsernameLength} ${matchWord(maximumUsernameLength, 'символ', 'ов', '', 'а')}.`);
		}
		
		if (!password || typeof password !== 'string' || password.length === 0) {
			validationErrors.push('Пароль не может быть пустым.');
		} else if (!availablePasswordSymbols.test(password)) {
			validationErrors.push('Пароль содержит недопустимые символы.');
		} else if (password.length < minimumPasswordLength) {
			validationErrors.push(`Пароль должен содержать не менее ${minimumPasswordLength} ${matchWord(minimumPasswordLength, 'символ', 'ов', '', 'а')}.`);
		} else if (password.length > maximumPasswordLength) {
			validationErrors.push(`Пароль должен содержать не более ${maximumPasswordLength} ${matchWord(maximumPasswordLength, 'символ', 'ов', '', 'а')}.`);
		}

		if (!message || typeof message !== 'string' || message.length === 0) {
			validationErrors.push('Сообщение не может быть пустым.');
		} else if (message.length > limitMessageLength) {
			validationErrors.push(`Сообщение не должно превышать ${limitMessageLength} ${matchWord(limitMessageLength, 'символ', 'ов', '', 'а')}.`);
		}

		if (validationErrors.length > 0) {
			return response.status(400).json({
				SUCCESS: false,
				VALIDATION_ERRORS: validationErrors
			});
		}

		if (!authenticateUser(username, getSha256Hash(password))) {
			return response.status(401).json({
				SUCCESS: false,
				MESSAGE: 'Неверное имя пользователя или пароль.'
			});
		}

		const [successResult, feedbackResult] = pushChatMessage(username, message, 'Пользователь', ipAddress);
		writeTimestampIntoProjectStorage(projectPaths.FILES.ACCUMULATED.UNFREEZING.USER, Date.now() + settings.API_REQUEST.BETWEEN_QUERIES / 4 * 1000);

		if (successResult === true) {
			updateHistory(feedbackResult);
			writeTimestampIntoProjectStorage(projectPaths.FILES.ACCUMULATED.UNFREEZING.LLM, 0);
			response.json({
				SUCCESS: true,
				MESSAGE: 'Сообщение успешно отправлено.'
			});
			console.log(`Получено сообщение от пользователя <${username}> с IP-адреса: «${ipAddress}» → {\n${message}\n}`);
		} else {
			console.error('Не удалось обновить файл чата.');
			response.status(500).json({
				SUCCESS: false,
				MESSAGE: 'Ваше сообщение не удалось записать в чат, поскольку на сервере произошла ошибка.'
			});
		}
	} catch (error) {
		console.error(`Случилась непредвиденная ситуация во время обработки сообщения от пользователя → ${formatErrorMessage(error)}`);
		response.status(500).json({
			SUCCESS: false,
			MESSAGE: 'Внутренняя ошибка сервера при обработке вашего сообщения.'
		});
	}
});

application.listen(settings.WEBSITE.SERVER_PORT, () => {
	console.log(`Веб-сервер запущен на порте ${settings.WEBSITE.SERVER_PORT}. [http://localhost:${settings.WEBSITE.SERVER_PORT}]`);
});



// ===== Подготовка промпта, главная функция и её вызов =====

function buildPrompt() {
	let parts = [];
	let content;

	content = readProjectFileContent(projectPaths.FILES.GENERAL.CHARACTER, 'персонажа', true);
	if (content !== '') parts.push(`===== Твоя личность =====\n\n${content}`);

	content = readProjectFileContent(projectPaths.FILES.GENERAL.INSTRUCTIONS, 'инструкций', false);
	parts.push(`===== Инструкции по использованию =====\n\n${content}`);

	content = formHistoryContent();
	if (content !== '') parts.push(`===== История последних действий =====\n\n${content}`);	

	content = readProjectFileContent(projectPaths.FILES.ACCUMULATED.PARSING_RESULT, 'для хранения результата парсинга сайта', true);
	if (content !== '') parts.push(`===== Результат последнего парсинга сайта =====\n\n${content}`);

	content = formTrackingContent();
	if (content !== '') parts.push(`===== Актуальная информация из файловой системы =====\n\n${content}`);

	content = readProjectFileContent(projectPaths.FILES.ACCUMULATED.MEMORY, 'памяти', true);
	if (content !== '') parts.push(`===== Долгосрочная память =====\n\n${content}`);

	content = `Текущая метка времени → [${getTimestamp()}]. Число элементов контекста истории → ${settings.PROMPT_LIMITS.HISTORY.TURNS}. Задержка в секундах между запросами к API → ${settings.API_REQUEST.BETWEEN_QUERIES}. Относительный путь до рабочей папки → «${path.relative(__dirname, projectPaths.FOLDERS.WORKSPACE)}».`;
	parts.push(`===== Прочая информация =====\n\n${content}`);

	content = formBlacklistContent();
	if (content !== '') parts.push(`===== Чёрный список пользователей =====\n\n${content}`);

	content = formChatContent(true);
	if (content !== '') parts.push(`===== Чат с пользователями =====\n\n${content}`);

	let resultContent = parts.join('\n\n\n\n');
	let resultTokens = tokenizer.encode(resultContent);
	const limitNumber = settings.PROMPT_LIMITS.TOTAL_TOKENS_COUNT;
	if (resultTokens.length > limitNumber) {
		resultTokens = resultTokens.slice(0, limitNumber);
		resultContent = `${tokenizer.decode(resultTokens)}…\n\nПромпт был обрезан по приближённому числу токенов! Срочно требуется почистить старые или бесполезные записи!`;
	}
	return resultContent;
}

async function main() {
	setConsoleTitle(path.basename(__dirname));
	while (!breakMainCycle) {
		try {
			if (Date.now() >= readTimestampFromProjectStorage(projectPaths.FILES.ACCUMULATED.UNFREEZING.LLM)) {
				const combinedPrompt = buildPrompt();
				//console.log(`→ {\n==== Сформированный промпт ====\n\n${combinedPrompt}\n}`);
				console.log(`Приближённое число потраченных токенов на промпт → ${tokenizer.encode(combinedPrompt).length}.`);
				
				if (geminiApiKey === null) {
					[geminiApiKey] = checkApiKeysAndGetArray();
				}
				// Эти объекты будут пересоздаваться на каждой итерации цикла, поскольку значение ключа может измениться в процессе.
				const genAI = new GoogleGenerativeAI(geminiApiKey);
				const model = genAI.getGenerativeModel({
					model: 'gemini-2.5-flash'
				});

				const result = await model.generateContent(combinedPrompt);
				const responseLLM = result.response.text();
				console.log(`Приближённое число полученных токенов → ${tokenizer.encode(responseLLM).length}.`);
				const feedback = await executeCommands(responseLLM);

				const action = `==== Ответ языковой модели ====\n\n${responseLLM}\n\n==== Парсинг программой ====\n\n${feedback}`;
				updateHistory(action);
				console.log(`→ {\n${action}\n}`);
			}
			await new Promise(resolve => setTimeout(resolve, settings.API_REQUEST.BETWEEN_QUERIES * 1000));
		} catch (error) {
			const feedback = 'Проблема использования Gemini API →';
			let description = null;

			// Неисправимые программой ошибки.
			if (error.message.includes('User location is not supported')) {
				description = `${feedback} Локация IP-адреса не поддерживается.`;
			} else if (error.message.includes('PROHIBITED_CONTENT')) {
				description = `${feedback} Запрос был заблокирован из-за нарушения политики допустимого использования — «PROHIBITED_CONTENT».`;
			}
			if (description !== null) {
				console.error(description);
				finishProcess();
			}

			// Ситуации, которые вполне легко можно исправить.
			if (error.message.includes('API key not valid')) {
				description = `${feedback} Недействительный ключ.`;
				exceptApiKey(geminiApiKey);
				geminiApiKey = null;
			} else if (error.message.includes('You exceeded your current quota')) {
				description = `${feedback} Достигнут лимит по запросам для ключа «${geminiApiKey}».`;
				tryChangeApiKey(geminiApiKey);
			}
			if (description !== null) {
				console.error(description);
			}

			// Прочие проблемы никак не обрабатываются.
			if (description === null) {
				console.error(`Перехвачена ошибка → ${formatErrorMessage(error)}`);
			}

			await new Promise(resolve => setTimeout(resolve, settings.API_REQUEST.FOR_CASE_OF_FAILURE * 1000));
		} finally {
			isUsed.SEND_MESSAGE = false;
			isUsed.FETCH_URL = false;
			isUsed.CLEAR_LAST_URL_CONTENT = false;
			isUsed.CLEAR_HISTORY = false;
			isUsed.WAIT = false;
		}
	}
}

main().catch(error => {
	console.error(`Критическая неисправность → ${formatErrorMessage(error)}`);
	finishProcess();
});



// ===== Алгоритмы обработки ответа языковой модели =====

function pullArguments(responseLLM, syntaxBeginIndex, commandName, argumentsQuantity) {
	if (typeof argumentsQuantity !== 'number' || !Number.isInteger(argumentsQuantity) || argumentsQuantity <= 0) {
		throw new Error('Для команды, имеющей аргументы, их количество должно быть указано натуральным числом.');
	}

	const firstDelimiter = '($$$$$';

	// Команда, которая должна иметь аргументы, может быть упомянута без них, и тогда следует сразу же её пропустить.
	if (responseLLM.indexOf(firstDelimiter, syntaxBeginIndex + commandName.length) !== syntaxBeginIndex + commandName.length) {
		return null;
	}

	const result = []; // Массив, формирующийся по принципу: впереди идут строковые значения, а конец всегда является числом.
	const commandStart = commandName + firstDelimiter;
	let currentIndex = syntaxBeginIndex + commandStart.length;

	for (let order = 1; order <= argumentsQuantity; order++) {
		// Проверка на существование ограничителя, предполагаемого на основе оставшегося числа аргументов.
		const isLast = order === argumentsQuantity;
		const nextDelimiter = isLast ? '$$$$$)' : '$$$$$, $$$$$';
		const delimiterIndex = responseLLM.indexOf(nextDelimiter, currentIndex);
		if (delimiterIndex === -1) {
			return null;
		}

		const argumentBeginningIndex = currentIndex;
		const argumentEndingIndex = delimiterIndex - 1;
		let argument;

		// Предусмотрение случая, когда между начальным и конечным ограничителями аргумента пустая строка.
		if (argumentBeginningIndex > argumentEndingIndex) {
			argument = '';
		}
		// Метод substring возвращает подстроку, содержащую символы, начиная с указанного индекса и до, НО НЕ ВКЛЮЧАЯ, другой индекс.
		else argument = responseLLM.substring(argumentBeginningIndex, argumentEndingIndex + 1);

		// Проверка на случай, если вдруг языковая модель написала вызов другой команды с параметрами в синтаксисе существующей.
		if (argument.includes(firstDelimiter)) {
			return null;
		}

		result.push(argument);
		currentIndex = delimiterIndex + nextDelimiter.length;
	}

	const syntaxEndIndex = currentIndex - 1; // Индекс символа в основной строке, который является концом синтаксиса обработанной команды.
	result.push(syntaxEndIndex);
	return result;
}

function processRecievedText(responseLLM) {
	let positionIndex = 0; // Индекс начала поиска команд.
	let complete = false; // Флаг окончания обработки текста.
	const structures = []; // Накопление структур из синтаксисов команд, которые прошли валидацию.
	do {
		if (positionIndex >= responseLLM.length) {
			complete = true;
		} else {
			// Проверка строки ответа языковой модели на команды — поиск ближайших индексов для каждого обозначения команды.
			const locationsOfCommands = [];
			for (let commandName of listOfCommands) {
				let startIndex = responseLLM.indexOf(commandName, positionIndex);
				locationsOfCommands.push(startIndex);
			}

			// Поиск ближайшего вхождения подстроки с командой при учёте фильтрации отрицательных результатов.
			let syntaxBeginIndex = Infinity; // Определяет, где должен начинаться синтаксис.
			let designationIdentifier = -1; // Индекс строкового названия из списка идентификаторов команд.
			for (let elementIndex = 0; elementIndex < locationsOfCommands.length; elementIndex++) {
				const currentElement = locationsOfCommands[elementIndex]; // Является числом.
				if (currentElement !== -1 && currentElement < syntaxBeginIndex) {
					syntaxBeginIndex = currentElement;
					designationIdentifier = elementIndex;
				}
			}

			// Если хоть одна команда была определена, следует создать структуру из её синтаксиса.
			if (syntaxBeginIndex !== Infinity) {
				const commandName = listOfCommands[designationIdentifier];
				let pullResult = null;
				let syntaxEndIndex;
				switch (commandName) {
					case 'MemoryAppend': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'MemoryEdit': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'MemoryRemove': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;

					case 'SendMessage': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'DeleteMessage': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'Punish': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 3); break;
					case 'Forgive': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					
					case 'FetchURL': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'ClearLastURLContent': pullResult = []; pullResult.push(syntaxBeginIndex + commandName.length - 1); break;

					case 'CreateFile': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'GetFileInfo': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'TrackFile': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'ForgetFile': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'CreateDirectory': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'TrackDirectory': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'ForgetDirectory': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'Delete': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;
					case 'Move': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'Rename': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'AddToFile': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'ReplaceInFile': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 3); break;
					case 'RemoveFromFile': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;
					case 'RewriteFile': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 2); break;

					case 'ClearHistory': pullResult = []; pullResult.push(syntaxBeginIndex + commandName.length - 1); break;
					case 'Wait': pullResult = pullArguments(responseLLM, syntaxBeginIndex, commandName, 1); break;

					default: pullResult = null;
				}
				if (pullResult !== null) {
					syntaxEndIndex = pullResult.pop(); // Извлечение индекса конца синтаксиса команды.
					const commandObject = {
						COMMAND_NAME: commandName,
						ARGUMENTS: pullResult
					};
					if (commandName === 'ClearLastURLContent' || commandName === 'DeleteMessage') {
						structures.unshift(commandObject);
					} else {
						structures.push(commandObject);
					}
					positionIndex = syntaxEndIndex + 1; // Наглядный выход из конца синтаксиса команды.
				} else { // Если же не удалось получить параметры команды, происходит пропуск, равный длине названия.
					positionIndex = syntaxBeginIndex + commandName.length;
				}				
			} else {
				complete = true;
			}
		}
	} while (!complete);
	return structures;
}

async function executeCommands(responseLLM) {
	const feedbacks = []; // Заполняется строковыми откликами результатов выполнения команд.
	const structures = processRecievedText(responseLLM);
	for (let commandObject of structures) {
		const commandName = commandObject.COMMAND_NAME;
		const commandParameters = commandObject.ARGUMENTS;
		switch (commandName) {
			case 'MemoryAppend': feedbacks.push(handleMemoryAppend(commandParameters)); break;
			case 'MemoryEdit': feedbacks.push(handleMemoryEdit(commandParameters)); break;
			case 'MemoryRemove': feedbacks.push(handleMemoryRemove(commandParameters)); break;

			case 'SendMessage': feedbacks.push(handleSendMessage(commandParameters)); break;
			case 'DeleteMessage': feedbacks.push(handleDeleteMessage(commandParameters)); break;
			case 'Punish': feedbacks.push(handlePunish(commandParameters)); break;
			case 'Forgive': feedbacks.push(handleForgive(commandParameters)); break;

			case 'FetchURL': feedbacks.push(await handleFetchURL(commandParameters)); break;
			case 'ClearLastURLContent': feedbacks.push(handleClearLastURLContent()); break;

			case 'CreateFile': feedbacks.push(handleCreateFile(commandParameters)); break;
			case 'GetFileInfo': feedbacks.push(handleGetFileInfo(commandParameters)); break;
			case 'TrackFile': feedbacks.push(handleTrackFile(commandParameters)); break;
			case 'ForgetFile': feedbacks.push(handleForgetFile(commandParameters)); break;
			case 'CreateDirectory': feedbacks.push(handleCreateDirectory(commandParameters)); break;
			case 'TrackDirectory': feedbacks.push(handleTrackDirectory(commandParameters)); break;
			case 'ForgetDirectory': feedbacks.push(handleForgetDirectory(commandParameters)); break;
			case 'Delete': feedbacks.push(handleDelete(commandParameters)); break;
			case 'Move': feedbacks.push(handleMove(commandParameters)); break;
			case 'Rename': feedbacks.push(handleRename(commandParameters)); break;
			case 'AddToFile': feedbacks.push(handleAddToFile(commandParameters)); break;
			case 'ReplaceInFile': feedbacks.push(handleReplaceInFile(commandParameters)); break;
			case 'RemoveFromFile': feedbacks.push(handleRemoveFromFile(commandParameters)); break;
			case 'RewriteFile': feedbacks.push(handleRewriteFile(commandParameters)); break;

			case 'ClearHistory': feedbacks.push(handleClearHistory(commandParameters)); break;
			case 'Wait': feedbacks.push(handleWait(commandParameters)); break;
		}
	}
	let result = 'Программа не смогла распознать ни одной команды управления.';
	if (feedbacks.length !== 0) {
		result = feedbacks.join('\n');
	}
	return result;
}



// ===== Обработчики команд управления системой =====

// --- 📒 Управляемый контекст памяти ---

function handleMemoryAppend(commandParameters) {
	let [additionalText] = commandParameters;
	const feedback = `Распознана команда MemoryAppend →`;

	try {
		additionalText = additionalText.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
		appendIntoFile(projectPaths.FILES.ACCUMULATED.MEMORY, additionalText);
		return `${feedback} Память была дополнена новым текстом.`;
	} catch (error) {
		return `Не удалось дописать содержимое памяти → ${formatErrorMessage(error)}`;
	}
}

function handleMemoryEdit(commandParameters) {
	let [existingStatement, suggestedChange] = commandParameters;
	const feedback = `Распознана команда MemoryEdit →`;
	
	try {
		existingStatement = existingStatement.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
		suggestedChange = suggestedChange.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
		const projectObject = projectPaths.FILES.ACCUMULATED.MEMORY;
		let fileContent = readProjectFileContent(projectObject, 'памяти', true);
		if (fileContent.includes(existingStatement)) {
			fileContent = fileContent.replaceAll(existingStatement, suggestedChange);
			writeIntoFile(projectObject, fileContent);
			return `${feedback} Все указанные подстроки отредактированы.`;
		}
		return `${feedback} Указанный текст не найден в памяти — изменений не произошло.`;
	} catch (error) {
		return `При редактировании памяти произошла ошибка → ${formatErrorMessage(error)}`;
	}
}

function handleMemoryRemove(commandParameters) {
	let [existingStatement] = commandParameters;
	const feedback = `Распознана команда MemoryRemove →`;

	try {
		existingStatement = existingStatement.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
		const projectObject = projectPaths.FILES.ACCUMULATED.MEMORY;
		let fileContent = readProjectFileContent(projectObject, 'памяти', true);
		if (fileContent.includes(existingStatement)) {
			fileContent = fileContent.replaceAll(existingStatement, '');
			writeIntoFile(projectObject, fileContent);
			return `${feedback} Каждое совпадение успешно удалено из содержимого памяти.`;
		}
		return `${feedback} Изменения не вступили в силу — указанной подстроки не существует.`;
	} catch (error) {
		return `Исключительная ситуация воспрепятствовала удалить текст из памяти → ${formatErrorMessage(error)}`;
	}
}

// --- 🎭 Управление и ведение чата ---

function handleSendMessage(commandParameters) {
	let [nickname, message] = commandParameters;
	const feedback = `Распознана команда SendMessage →`;

	if (isUsed.SEND_MESSAGE) {
		return `${feedback} Эту команду можно использовать только один раз за промпт.`;
	}
	isUsed.SEND_MESSAGE = true;

	nickname = nickname.replace(/\s+/g, ' ').trim();
	message = message.replaceAll('\\n', '\n').replaceAll('\\t', '\t').trim();

	if (nickname.length === 0) {
		return `${feedback} Никнейм не может быть пустым.`;
	}
	if (message.length === 0) {
		return `${feedback} Сообщение не может быть пустым.`;
	}

	const [successResult, designation] = pushChatMessage(nickname, message, 'Администратор', null);
	if (!successResult) {
		return `${feedback} (Неудача) ${designation}`;
	}
	return `${feedback} (Успех) ${designation}`;
}

function handleDeleteMessage(commandParameters) {
	let [identifierString] = commandParameters;
	const feedback = `Распознана команда DeleteMessage с параметром ${identifierString} →`;

	const identifier = parseInt(identifierString, 10);
	if (isNaN(identifier) || !Number.isInteger(identifier) || identifier <= 0) {
		return `${feedback} Идентификатор сообщения должен быть натуральным числом.`;
	}

	const [successResult, designation] = deleteChatMessage(identifier);

	if (!successResult) {
		return `${feedback} (Неудача) ${designation}`;
	}
	return `${feedback} (Успех) ${designation}`;
}

function handlePunish(commandParameters) {
	let [username, ipAddress, reason] = commandParameters;
	const feedback = `Распознана команда Punish →`;
	
	username = username.replace(/\s+/g, ' ').trim();
	ipAddress = ipAddress.trim();
	reason = reason.trim();

	if (username.length === 0) {
		return `${feedback} Имя пользователя не может быть пустым.`;
	}
	if (ipAddress.length === 0) {
		return `${feedback} IP-адрес не может быть пустым.`;
	}
	if (reason.length === 0) {
		return `${feedback} Причина блокировки не может быть пустой.`;
	}

	return `${feedback} ${pushIntoBlacklist(username, ipAddress, reason)}`;
}

function handleForgive(commandParameters) {
    let [ipAddress] = commandParameters;
    const feedback = `Распознана команда Forgive →`;

    ipAddress = ipAddress.trim();
    if (ipAddress.length === 0) {
		return `${feedback} IP-адрес не может быть пустым.`;
	}
    const [successResult, resultMessage] = deleteFromBlacklist(ipAddress);

    if (successResult) {
        return `${feedback} (Успех) ${resultMessage}`;
    } else {
        return `${feedback} (Неудача) ${resultMessage}`;
    }
}

// --- 🌐 Парсинг сайтов ---

async function handleFetchURL(commandParameters) {
	let [urlAddress] = commandParameters;
	const feedback = `Распознана команда FetchURL →`;

	if (isUsed.FETCH_URL) {
		return `${feedback} В этом промпте больше нельзя использовать эту команду.`;
	}
	isUsed.FETCH_URL = true;

	try {
		urlAddress = urlAddress.trim();
		if (urlAddress.length === 0) {
			return `${feedback} URL-адрес не может быть пустым.`;
		}
		if (!urlAddress.startsWith('http://') && !urlAddress.startsWith('https://')) {
			return `${feedback} Некорректный формат URL-адреса: должен начинаться с «http://» или «https://».`;
		}

		let response;
		try {
			const controller = new AbortController();
			const timeoutObject = setTimeout(() => controller.abort(), 15 * 1000); 
			response = await fetch(urlAddress, { signal: controller.signal });
			clearTimeout(timeoutObject);
		} catch (exception) {
			if (exception.name === 'AbortError') {
				return `${feedback} Превышено время ожидания запроса.`;
			}
			return `${feedback} Ошибка при выполнении сетевого запроса → ${formatErrorMessage(exception)}.`;
		}

		if (!response.ok) {
			return `${feedback} Неудачный статус ответа «${response.status}».`;
		}

		const contentType = response.headers.get('content-type');
		if (!contentType || !contentType.startsWith('text/')) {
			return `${feedback} Неподдерживаемый тип содержимого: «${contentType || 'не указан'}». Ожидается текстовый контент.`;
		}

		let rawContent = await response.text();
		const truncationMessages = [];

		const byteLimit = settings.PROMPT_LIMITS.FETCH_URL.BYTES;
		const initialByteLength = Buffer.byteLength(rawContent, 'utf8');
		if (initialByteLength > byteLimit) {
			const initialBuffer = Buffer.from(rawContent, 'utf8');
			const truncatedBuffer = initialBuffer.slice(0, byteLimit);
			rawContent = truncatedBuffer.toString('utf8');
			truncationMessages.push(`Контент обрезан по байтовому лимиту.`);
		}

		let extractedText = stripHtmlTags(rawContent);

		const tokenLimit = settings.PROMPT_LIMITS.FETCH_URL.TOKENS;
		const initialTokensCount = tokenizer.encode(extractedText).length;
		if (initialTokensCount > tokenLimit) {
			const initialTokens = tokenizer.encode(extractedText);
			const truncatedTokens = initialTokens.slice(0, tokenLimit);
			extractedText = tokenizer.decode(truncatedTokens);
			truncationMessages.push(`Контент обрезан по токеновому лимиту.`);
		}

		let finalContent = `Содержимое URL «${urlAddress}» → {\n${extractedText}\n}`;
		if (extractedText === '') {
			finalContent = `URL «${urlAddress}» не содержит читаемого текстового контента или он пуст после обработки.`;
		}

		writeIntoFile(projectPaths.FILES.ACCUMULATED.PARSING_RESULT, finalContent); 

		let successMessage = `Успешно получен контент URL-адреса «${urlAddress}».`;
		if (truncationMessages.length > 0) {
			successMessage += ` ${truncationMessages.join(' ')}`;
		}
		
		return `${feedback} ${successMessage}`;
	} catch (error) {
		return `${feedback} Произошла ошибка во время парсинга сайта → ${formatErrorMessage(error)}.`;
	}
}

function handleClearLastURLContent() {
	const feedback = `Распознана команда ClearLastURLContent →`;

	if (isUsed.CLEAR_LAST_URL_CONTENT) {
		return `${feedback} В этом промпте больше нельзя использовать эту команду.`;
	}
	isUsed.CLEAR_LAST_URL_CONTENT = true;

	try {
		writeIntoFile(projectPaths.FILES.ACCUMULATED.PARSING_RESULT, '');
		return `${feedback} Данные по последнему URL-адресу стёрты.`;
	} catch (error) {
		return `${feedback} Не удалось очистить содержимое последнего парсинга сайта → ${formatErrorMessage(error)}.`;
	}
}

// --- ⚙️ Управление файловой системой ---

function handleCreateFile(commandParameters) {
	let [parentDirectoryPath, newFileName] = commandParameters;
	const feedback = `Распознана команда CreateFile →`;

	parentDirectoryPath = parentDirectoryPath.trim();
	newFileName = newFileName.trim();

	if (parentDirectoryPath.length === 0) {
		return `${feedback} Путь к родительской директории не может быть пустым.`;
	}
	if (newFileName.length === 0) {
		return `${feedback} Имя нового файла не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedParentPath = path.resolve(parentDirectoryPath); 
		if (!fs.existsSync(resolvedParentPath)) {
			return `${feedback} Родительская директория не найдена.`;
		}
		if (!fs.statSync(resolvedParentPath).isDirectory()) {
			return `${feedback} Указанный родительский путь не является директорией.`;
		}

		const filePath = path.join(resolvedParentPath, newFileName);
		if (!filePath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (fs.existsSync(filePath)) {
			return `${feedback} Указанный файл уже существует.`;
		}

		fs.writeFileSync(filePath, '', 'utf-8');
		return `${feedback} Новый файл «${newFileName}» успешно создан по пути «${parentDirectoryPath}».`;
	} catch (exception) {
		return `${feedback} Произошла ошибка во время создания нового файла → ${formatErrorMessage(exception)}.`;
	}
}

function handleGetFileInfo(commandParameters) {
	let [objectPath] = commandParameters;
	const feedback = `Распознана команда GetFileInfo →`;

	objectPath = objectPath.trim();
	if (objectPath.length === 0) {
		return `${feedback} Путь к файлу не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedPath = path.resolve(objectPath);
		if (!resolvedPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (!fs.existsSync(resolvedPath)) {
			return `${feedback} Объект по указанному пути не существует.`;
		}
		const stats = fs.statSync(resolvedPath);
		if (!stats.isFile()) {
			return `${feedback} Указанный объект не является файлом.`;
		}
		return `${feedback} Получена информация о файле «${objectPath}» → Размер в байтах: ${stats.size}; Был изменён: ${stats.mtime.toLocaleString()}; Права доступа chmod: ${(stats.mode & 0o777).toString(8)}.`;
	} catch (exception) {
		return `${feedback} Произошла ошибка во время получения информации о файле → ${formatErrorMessage(exception)}.`;
	}
}

function handleTrackFile(commandParameters) {
	let [suggestedFilePath] = commandParameters;
	const feedback = `Распознана команда TrackFile →`;

	suggestedFilePath = suggestedFilePath.trim();
	if (suggestedFilePath.length === 0) {
		return `${feedback} Путь к файлу для отслеживания не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const fullPath = path.resolve(suggestedFilePath);

		if (!fullPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (!fs.existsSync(fullPath)) {
			return `${feedback} Отслеживаемый файл не найден.`;
		}
		const stats = fs.statSync(fullPath);
		if (!stats.isFile()) {
			return `${feedback} Указанный путь не является файлом.`;
		}

		const [isBinary] = binaryFileExpectation(fullPath);
		if (isBinary) {
			return `${feedback} Нельзя отслеживать бинарные файлы.`;
		}

		const projectObject = projectPaths.FILES.ACCUMULATED.TRACKING.FILES;
		let trackedFiles = readArrayFromProjectFile(projectObject);
		const relativePathToStore = path.relative(__dirname, fullPath);

		if (trackedFiles.includes(relativePathToStore)) {
			return `${feedback} Файл «${relativePathToStore}» уже отслеживается.`;
		}

		trackedFiles.push(relativePathToStore);
		writeIntoFile(projectObject, JSON.stringify(trackedFiles, null, '\t'));
		return `${feedback} Файл «${relativePathToStore}» успешно добавлен в список отслеживаемых.`;
	} catch (error) {
		return `${feedback} Не удалось добавить файл в список отслеживаемых → ${formatErrorMessage(error)}.`;
	}
}

function handleForgetFile(commandParameters) {
	let [filePathToForget] = commandParameters;
	const feedback = `Распознана команда ForgetFile →`;

	filePathToForget = filePathToForget.trim();
	if (filePathToForget.length === 0) {
		return `${feedback} Путь к файлу для удаления из отслеживания не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const fullPathToForget = path.resolve(filePathToForget);
		if (!fullPathToForget.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}

		const projectObject = projectPaths.FILES.ACCUMULATED.TRACKING.FILES;
		let trackedFiles = readArrayFromProjectFile(projectObject);
		const relativePathToForget = path.relative(__dirname, fullPathToForget);

		const initialLength = trackedFiles.length;
		const updatedTrackedFiles = trackedFiles.filter(elementValue => elementValue !== relativePathToForget);

		if (updatedTrackedFiles.length === initialLength) {
			return `${feedback} Файл «${relativePathToForget}» не найден в списке отслеживаемых.`;
		}

		writeIntoFile(projectObject, JSON.stringify(updatedTrackedFiles, null, '\t'));
		return `${feedback} Файл «${relativePathToForget}» успешно удалён из списка отслеживаемых.`;
	} catch (error) {
		return `${feedback} Не удалось удалить файл из списка отслеживаемых → ${formatErrorMessage(error)}.`;
	}
}

function handleCreateDirectory(commandParameters) {
	let [parentDirectoryPath, newDirectoryName] = commandParameters;
	const feedback = `Распознана команда CreateDirectory →`;

	parentDirectoryPath = parentDirectoryPath.trim();
	newDirectoryName = newDirectoryName.trim();

	if (parentDirectoryPath.length === 0) {
		return `${feedback} Путь к родительской директории не может быть пустым.`;
	}
	if (newDirectoryName.length === 0) {
		return `${feedback} Имя нового каталога не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedParentPath = path.resolve(parentDirectoryPath);
		if (!fs.existsSync(resolvedParentPath)) {
			return `${feedback} Родительская директория не найдена.`;
		}
		if (!fs.statSync(resolvedParentPath).isDirectory()) {
			return `${feedback} Указанный родительский путь не является директорией.`;
		}

		const objectPath = path.join(resolvedParentPath, newDirectoryName);
		if (!objectPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (fs.existsSync(objectPath)) {
			return `${feedback} Указанный каталог уже существует.`;
		}
		fs.mkdirSync(objectPath);
		return `${feedback} Новый каталог «${newDirectoryName}» успешно создан по пути «${parentDirectoryPath}».`;
	} catch (exception) {
		return `${feedback} Произошла ошибка во время создания новой папки → ${formatErrorMessage(exception)}.`;
	}
}

function handleTrackDirectory(commandParameters) {
	let [suggestedDirectoryPath] = commandParameters;
	const feedback = `Распознана команда TrackDirectory →`;

	suggestedDirectoryPath = suggestedDirectoryPath.trim();
	if (suggestedDirectoryPath.length === 0) {
		return `${feedback} Путь к директории для отслеживания не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const fullPath = path.resolve(suggestedDirectoryPath);

		if (!fullPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (!fs.existsSync(fullPath)) {
			return `${feedback} Отслеживаемая директория не найдена.`;
		}
		const stats = fs.statSync(fullPath);
		if (!stats.isDirectory()) {
			return `${feedback} Указанный путь не является директорией.`;
		}

		const projectObject = projectPaths.FILES.ACCUMULATED.TRACKING.FOLDERS;
		let trackedDirectories = readArrayFromProjectFile(projectObject);
		const relativePathToStore = path.relative(__dirname, fullPath);

		if (trackedDirectories.includes(relativePathToStore)) {
			return `${feedback} Директория «${relativePathToStore}» уже отслеживается.`;
		}

		trackedDirectories.push(relativePathToStore);
		writeIntoFile(projectObject, JSON.stringify(trackedDirectories, null, '\t'));
		return `${feedback} Директория «${relativePathToStore}» успешно добавлена в список отслеживаемых.`;
	} catch (error) {
		return `${feedback} Не удалось добавить директорию в список отслеживаемых → ${formatErrorMessage(error)}.`;
	}
}

function handleForgetDirectory(commandParameters) {
	let [directoryPathToForget] = commandParameters;
	const feedback = `Распознана команда ForgetDirectory →`;

	directoryPathToForget = directoryPathToForget.trim();
	if (directoryPathToForget.length === 0) {
		return `${feedback} Путь к директории для удаления из отслеживания не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const fullPathToForget = path.resolve(directoryPathToForget);
		if (!fullPathToForget.startsWith(path.resolve(projectPaths.FOLDERS.WORKSPACE))) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}

		const projectObject = projectPaths.FILES.ACCUMULATED.TRACKING.FOLDERS;
		let trackedDirectories = readArrayFromProjectFile(projectObject);
		const relativePathToForget = path.relative(__dirname, fullPathToForget);

		const initialLength = trackedDirectories.length;
		const updatedTrackedDirectories = trackedDirectories.filter(elementValue => elementValue !== relativePathToForget);

		if (updatedTrackedDirectories.length === initialLength) {
			return `${feedback} Директория «${relativePathToForget}» не найдена в списке отслеживаемых.`;
		}

		writeIntoFile(projectObject, JSON.stringify(updatedTrackedDirectories, null, '\t'));
		return `${feedback} Директория «${relativePathToForget}» успешно удалена из списка отслеживаемых.`;
	} catch (error) {
		return `${feedback} Случилась ошибка, из-за которой не вышло открепить отслеживаемую папку → ${formatErrorMessage(error)}.`;
	}
}

function handleDelete(commandParameters) {
	let [objectPath] = commandParameters;
	const feedback = `Распознана команда Delete →`;

	objectPath = objectPath.trim();
	if (objectPath.length === 0) {
		return `${feedback} Путь к объекту для удаления не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedPath = path.resolve(objectPath);
		if (!resolvedPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (resolvedPath === projectPaths.FOLDERS.WORKSPACE) {
			return `${feedback} Нельзя удалить рабочую папку станции.`;
		}

		if (!fs.existsSync(resolvedPath)) {
			return `${feedback} Объект по указанному пути «${objectPath}» не был найден.`;
		}
		const stats = fs.statSync(resolvedPath);
		if (stats.isFile()) {
			fs.unlinkSync(resolvedPath);
			return `${feedback} Файл «${objectPath}» успешно удалён.`;
		} else if (stats.isDirectory()) {
			fs.rmSync(resolvedPath, { recursive: true, force: true });
			return `${feedback} Каталог «${objectPath}» успешно удалён.`;
		}
		return `${feedback} Удаление этого типа объекта не поддерживается.`;
	} catch (error) {
		return `${feedback} Возникла исключительная ситуация в процессе удаления объекта «${objectPath}» → ${formatErrorMessage(error)}.`;
	}
}

function handleMove(commandParameters) {
	let [existingPath, newPath] = commandParameters;
	const feedback = `Распознана команда Move →`;

	existingPath = existingPath.trim();
	newPath = newPath.trim();

	if (existingPath.length === 0) {
		return `${feedback} Исходный путь не может быть пустым.`;
	}
	if (newPath.length === 0) {
		return `${feedback} Путь назначения не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedExistingPath = path.resolve(existingPath);
		const resolvedNewPath = path.resolve(newPath);

		if (!resolvedExistingPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Исходный путь «${existingPath}» находится за пределами рабочего каталога.`;
		}
		if (!resolvedNewPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Путь назначения «${newPath}» находится за пределами рабочего каталога.`;
		}
		if (resolvedExistingPath === projectPaths.FOLDERS.WORKSPACE) {
			return `${feedback} Нельзя переместить рабочую папку станции.`;
		}
		if (!fs.existsSync(resolvedExistingPath)) {
			return `${feedback} Исходный объект по пути «${existingPath}» не найден.`;
		}

		if (fs.existsSync(resolvedNewPath)) {
			const existingPathStats = fs.statSync(resolvedExistingPath);
			const newPathStats = fs.statSync(resolvedNewPath);

			if (newPathStats.isDirectory()) {
				if (existingPathStats.isDirectory() && resolvedNewPath.startsWith(resolvedExistingPath + path.sep)) {
					return `${feedback} Нельзя переместить директорию «${existingPath}» в её же поддиректорию «${newPath}».`;
				}
				return `${feedback} В пути назначения уже существует объект. Перемещение может привести к его перезаписи или некорректному поведению.`;
			} else if (newPathStats.isFile()) {
				return `${feedback} В пути назначения уже существует файл. Перемещение приведет к его перезаписи.`;
			}
		}

		fs.renameSync(resolvedExistingPath, resolvedNewPath);
		return `${feedback} Объект успешно перемещён из «${path.relative(__dirname, resolvedExistingPath)}» в «${path.relative(__dirname, resolvedNewPath)}».`;
	} catch (error) {
		return `${feedback} Произошла ошибка во время перемещения объекта → ${formatErrorMessage(error)}.`;
	}
}

function handleRename(commandParameters) {
	let [objectPath, newName] = commandParameters;
	const feedback = `Распознана команда Rename →`;

	objectPath = objectPath.trim();
	newName = newName.trim();

	if (objectPath.length === 0) {
		return `${feedback} Путь к объекту для переименования не может быть пустым.`;
	}
	if (newName.length === 0) {
		return `${feedback} Новое имя не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedPath = path.resolve(objectPath);
		if (!resolvedPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (resolvedPath === projectPaths.FOLDERS.WORKSPACE) {
			return `${feedback} Нельзя переименовать рабочую папку станции.`;
		}
		if (!fs.existsSync(resolvedPath)) {
			return `${feedback} Объект по пути «${objectPath}» не найден.`;
		}

		if (newName.includes(path.sep) || newName.includes('/') || newName.includes('\\')) {
			return `${feedback} Новое имя «${newName}» не может содержать разделители пути (/, \\, ${path.sep}).`;
		}

		const parentDirectory = path.dirname(resolvedPath);
		const newFullPath = path.join(parentDirectory, newName);

		if (fs.existsSync(newFullPath) && newFullPath !== resolvedPath) {
			return `${feedback} В директории «${path.relative(__dirname, parentDirectory)}» уже существует объект с именем «${newName}».`;
		}

		fs.renameSync(resolvedPath, newFullPath);
		return `${feedback} Объект «${path.basename(resolvedPath)}» успешно переименован в «${newName}».`;
	} catch (error) {
		return `${feedback} Произошла ошибка во время переименования объекта → ${formatErrorMessage(error)}.`;
	}
}

function handleAddToFile(commandParameters) {
	let [objectPath, newRecord] = commandParameters;
	const feedback = `Распознана команда AddToFile →`;

	objectPath = objectPath.trim();
	newRecord = newRecord.replaceAll('\\n', '\n').replaceAll('\\t', '\t');

	if (objectPath.length === 0) {
		return `${feedback} Путь к файлу не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedPath = path.resolve(objectPath);
		if (!resolvedPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (!fs.existsSync(resolvedPath)) {
			return `${feedback} Объект по указанному пути «${objectPath}» не был найден.`;
		}
		const stats = fs.statSync(resolvedPath);
		if (!stats.isFile()) {
			return `${feedback} Указанный путь «${objectPath}» ведёт к объекту, который не является файлом.`;
		}
		let [isBinary] = binaryFileExpectation(resolvedPath);
		if (isBinary) {
			return `${feedback} Нельзя записать текст в бинарный файл «${objectPath}».`;
		}

		fs.appendFileSync(resolvedPath, newRecord, 'utf-8');
		return `${feedback} Успешно добавлен текст в конец файла «${objectPath}».`;
	} catch (error) {
		return `${feedback} Не удалось выполнить операцию дозаписи текста в файл «${objectPath}» → ${formatErrorMessage(error)}.`;
	}
}

function handleReplaceInFile(commandParameters) {
	let [objectPath, existingStatement, suggestedChange] = commandParameters;
	const feedback = `Распознана команда ReplaceInFile →`;

	objectPath = objectPath.trim();
	existingStatement = existingStatement.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
	suggestedChange = suggestedChange.replaceAll('\\n', '\n').replaceAll('\\t', '\t');

	if (objectPath.length === 0) {
		return `${feedback} Путь к файлу не может быть пустым.`;
	}
	if (existingStatement.length === 0) {
		return `${feedback} Исходный текст для замены не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedPath = path.resolve(objectPath);
		if (!resolvedPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (!fs.existsSync(resolvedPath)) {
			return `${feedback} Объект по указанному пути «${objectPath}» не был найден.`;
		}
		const stats = fs.statSync(resolvedPath);
		if (!stats.isFile()) {
			return `${feedback} Указанный путь «${objectPath}» ведёт к объекту, который не является файлом.`;
		}

		let [isBinary, fileContent] = binaryFileExpectation(resolvedPath);
		if (isBinary) {
			return `${feedback} Нельзя заменить текст в бинарном файле «${objectPath}».`;
		}

		if (fileContent.includes(existingStatement)) {
			fileContent = fileContent.replaceAll(existingStatement, suggestedChange);
			fs.writeFileSync(resolvedPath, fileContent, 'utf-8');
			return `${feedback} Все совпадающие подстроки «${existingStatement}» были заменены на новые в файле «${objectPath}».`;
		}
		return `${feedback} Указанный текст «${existingStatement}» не найден в файле «${objectPath}» — изменений не произошло.`;
	} catch (error) {
		return `${feedback} При редактировании файла «${objectPath}» произошла ошибка → ${formatErrorMessage(error)}.`;
	}
}

function handleRemoveFromFile(commandParameters) {
	let [objectPath, existingStatement] = commandParameters;
	const feedback = `Распознана команда RemoveFromFile →`;

	objectPath = objectPath.trim();
	existingStatement = existingStatement.replaceAll('\\n', '\n').replaceAll('\\t', '\t');

	if (objectPath.length === 0) {
		return `${feedback} Путь к файлу не может быть пустым.`;
	}
	if (existingStatement.length === 0) {
		return `${feedback} Текст для удаления не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedPath = path.resolve(objectPath);
		if (!resolvedPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (!fs.existsSync(resolvedPath)) {
			return `${feedback} Объект по указанному пути «${objectPath}» не был найден.`;
		}
		const stats = fs.statSync(resolvedPath);
		if (!stats.isFile()) {
			return `${feedback} Указанный путь «${objectPath}» ведёт к объекту, который не является файлом.`;
		}
		
		let [isBinary, fileContent] = binaryFileExpectation(resolvedPath);
		if (isBinary) {
			return `${feedback} Нельзя удалить текст из бинарного файла «${objectPath}».`;
		}

		if (fileContent.includes(existingStatement)) {
			fileContent = fileContent.replaceAll(existingStatement, '');
			fs.writeFileSync(resolvedPath, fileContent, 'utf-8');
			return `${feedback} Удалено каждое вхождение подстроки «${existingStatement}» из файла «${objectPath}».`;
		}
		return `${feedback} Указанный текст «${existingStatement}» не найден в файле «${objectPath}» — изменений не произошло.`;
	} catch (error) {
		return `${feedback} Произошла ошибка во время удаления фрагмента текста из файла «${objectPath}» → ${formatErrorMessage(error)}.`;
	}
}

function handleRewriteFile(commandParameters) {
	let [objectPath, newContent] = commandParameters;
	const feedback = `Распознана команда RewriteFile →`;

	objectPath = objectPath.trim();
	newContent = newContent.replaceAll('\\n', '\n').replaceAll('\\t', '\t');

	if (objectPath.length === 0) {
		return `${feedback} Путь к файлу не может быть пустым.`;
	}

	checkWorkspaceFolderExistence();

	try {
		const resolvedPath = path.resolve(objectPath);
		if (!resolvedPath.startsWith(projectPaths.FOLDERS.WORKSPACE)) {
			return `${feedback} Нельзя получить данные за пределами рабочего каталога.`;
		}
		if (!fs.existsSync(resolvedPath)) {
			return `${feedback} Объект по указанному пути «${objectPath}» не был найден.`;
		}
		const stats = fs.statSync(resolvedPath);
		if (!stats.isFile()) {
			return `${feedback} Указанный путь «${objectPath}» ведёт к объекту, который не является файлом.`;
		}

		let [isBinary] = binaryFileExpectation(resolvedPath);
		if (isBinary) {
			return `${feedback} Нельзя переписать текст в бинарном файле «${objectPath}».`;
		}

		fs.writeFileSync(resolvedPath, newContent, 'utf-8');
		return `${feedback} Содержимое файла «${objectPath}» успешно перезаписано.`;
	} catch (error) {
		return `${feedback} Перезаписать файл «${objectPath}» не удалось → ${formatErrorMessage(error)}.`;
	}
}

// --- 💎 Уникальные команды ---

function handleClearHistory() {
	const feedback = `Распознана команда ClearHistory →`;

	if (isUsed.CLEAR_HISTORY) {
		return `${feedback} В этом промпте больше нельзя использовать эту команду.`;
	}
	isUsed.CLEAR_HISTORY = true;

	try {
		writeIntoFile(projectPaths.FILES.ACCUMULATED.HISTORY, JSON.stringify([], null, '\t'));
		return `${feedback} Содержимое истории было успешно очищено.`;
	} catch (error) {
		return `${feedback} Не удалось очистить содержимое истории → ${formatErrorMessage(error)}.`;
	}
}

function handleWait(commandParameters) {
	let [stringValue] = commandParameters;
	const feedback = `Распознана команда Wait →`;

	if (isUsed.WAIT) {
		return `${feedback} В этом промпте больше нельзя использовать эту команду.`;
	}
	isUsed.WAIT = true;

	stringValue = stringValue.trim();
	if (stringValue.length === 0) {
		return `${feedback} Параметр (количество минут) не может быть пустым.`;
	}

	const minutes = parseInt(stringValue, 10);
	if (isNaN(minutes) || !Number.isInteger(minutes) || minutes <= 0) {
		return `${feedback} Параметр (количество минут) должен быть натуральным числом.`;
	}

	try {
		const timestamp = Date.now() + minutes * 60 * 1000;
		writeTimestampIntoProjectStorage(projectPaths.FILES.ACCUMULATED.UNFREEZING.LLM, timestamp);

		const formattedDate = new Date(timestamp).toLocaleString('ru-RU', {
			year: 'numeric', month: '2-digit', day: '2-digit',
			hour: '2-digit', minute: '2-digit', second: '2-digit'
		});

		return `${feedback} Установлена задержка в ${minutes} ${matchWord(minutes, 'минут', '', 'у', 'ы')}. Следующий запрос к API произойдёт не раньше [${formattedDate}].`;
	} catch (error) {
		return `${feedback} Не удалось установить задержку → ${formatErrorMessage(error)}.`;
	}
}