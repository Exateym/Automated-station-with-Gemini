document.addEventListener('DOMContentLoaded', () => {
	const chatDisplay = document.getElementById('chatDisplay');
	const messageForm = document.getElementById('messageForm');
	const usernameInput = document.getElementById('usernameInput');
	const usernameFeedback = document.getElementById('usernameFeedback');
	const passwordInput = document.getElementById('passwordInput');
	const passwordFeedback = document.getElementById('passwordFeedback');
	const messageInput = document.getElementById('messageInput');
	const messageFeedback = document.getElementById('messageFeedback');
	const serverResponse = document.getElementById('serverResponse');

	const settings = {
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
	};

	let refreshChatIntervalObject = null;

	async function fetchSettings() {
		try {
			const response = await fetch('/settings');
			const data = await response.json();
			if (data.SUCCESS) {
				settings.CLIENT_REFRESH = data.CLIENT_REFRESH;
				settings.LENGTH_LIMIT.USERNAME.MINIMUM = data.LENGTH_LIMIT.USERNAME.MINIMUM;
				settings.LENGTH_LIMIT.USERNAME.MAXIMUM = data.LENGTH_LIMIT.USERNAME.MAXIMUM;
				settings.LENGTH_LIMIT.PASSWORD.MINIMUM = data.LENGTH_LIMIT.PASSWORD.MINIMUM;
				settings.LENGTH_LIMIT.PASSWORD.MAXIMUM = data.LENGTH_LIMIT.PASSWORD.MAXIMUM;
				settings.LENGTH_LIMIT.MESSAGE = data.LENGTH_LIMIT.MESSAGE;

				if (refreshChatIntervalObject !== null) {
					clearInterval(refreshChatIntervalObject);
				}
				refreshChatIntervalObject = setInterval(fetchChat, data.CLIENT_REFRESH * 1000);
			}
		} catch (error) {
			if (refreshChatIntervalObject === null) {
				refreshChatIntervalObject = setInterval(fetchChat, settings.CLIENT_REFRESH * 1000);
			}
		}
		usernameInput.dispatchEvent(new Event('input'));
		messageInput.dispatchEvent(new Event('input'));
	}

	async function fetchHashcode() {
		const controller = new AbortController();
		const timeoutObject = setTimeout(() => controller.abort(), 15 * 1000);

		try {
			const response = await fetch('/hashcode', {
				signal: controller.signal
			});
			clearTimeout(timeoutObject);
			const data = await response.json();
			if (data.SUCCESS) {
				return data.HASHCODE;
			} else {
				return null;
			}
		} catch (error) {
			clearTimeout(timeoutObject);
			return null;
		}
	}

	let currentHashcode = null;
	let hasScrolledInitially = false;
	
	async function fetchChat() {
		try {
			const recievedHashcode = await fetchHashcode();

			if (recievedHashcode === null) {
				chatDisplay.textContent = 'Не удалось подключиться к серверу для получения чата.';
				chatDisplay.scrollTop = chatDisplay.scrollHeight;
				currentHashcode = null;
				return;
			}

			if (currentHashcode !== recievedHashcode) {
				const response = await fetch('/chat');
				const data = await response.json();

				if (data.SUCCESS) {
					chatDisplay.textContent = data.CHAT;
					if (!hasScrolledInitially) {
						chatDisplay.scrollTop = chatDisplay.scrollHeight;
						hasScrolledInitially = true;
					}
					currentHashcode = recievedHashcode;
				} else {
					chatDisplay.textContent = `Ошибка загрузки чата → {\n${data.MESSAGE}\n}`;
					chatDisplay.scrollTop = chatDisplay.scrollHeight;
					currentHashcode = null;
				}
			}
		} catch (error) {
			chatDisplay.textContent = 'Не удалось подключиться к серверу для получения чата.';
			chatDisplay.scrollTop = chatDisplay.scrollHeight;
			currentHashcode = null;
		}
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

	const availableUsernameSymbols = /^[a-zA-Zа-яА-Я0-9_ ]+$/;

	usernameInput.addEventListener('input', () => {
		const length = usernameInput.value.length;
		if (length === 0) {
			usernameFeedback.textContent = 'Поле является обязательным для заполнения.';
			usernameFeedback.className = 'validation-feedback yellow';
		} else {
			const minimumUsernameLength = settings.LENGTH_LIMIT.USERNAME.MINIMUM;
			const maximumUsernameLength = settings.LENGTH_LIMIT.USERNAME.MAXIMUM;

			if (
				length < minimumUsernameLength ||
				length > maximumUsernameLength ||
				!availableUsernameSymbols.test(usernameInput.value)
			) {
				usernameFeedback.className = 'validation-feedback red';
			} else {
				usernameFeedback.className = 'validation-feedback green';
			}
			
			const feedback = `Ввод содержит ${length} ${matchWord(length, 'символ', 'ов', '', 'а')}.`;
			if (length < minimumUsernameLength) {
				usernameFeedback.textContent = `${feedback} Недостаточно!`;
			} else if (length > maximumUsernameLength) {
				usernameFeedback.textContent = `${feedback} Слишком много!`;
			} else if (!availableUsernameSymbols.test(usernameInput.value)) {
				usernameFeedback.textContent = 'Имя пользователя может содержать только буквы русского и английского алфавита, нижнее подчёркивание, пробел и цифры.';
			} else {
				usernameFeedback.textContent = feedback;
			}
		}
	});

	usernameInput.dispatchEvent(new Event('input'));

	const availablePasswordSymbols = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+$/; // Объявить глобально или передать

	passwordInput.addEventListener('input', () => {
		const length = passwordInput.value.length;
		if (length === 0) {
			passwordFeedback.textContent = 'Поле является обязательным для заполнения.';
			passwordFeedback.className = 'validation-feedback yellow';
		} else {
			const minimumPasswordLength = settings.LENGTH_LIMIT.PASSWORD.MINIMUM;
			const maximumPasswordLength = settings.LENGTH_LIMIT.PASSWORD.MAXIMUM;

			if (
				length < minimumPasswordLength ||
				length > maximumPasswordLength ||
				!availablePasswordSymbols.test(passwordInput.value)
			) {
				passwordFeedback.className = 'validation-feedback red';
			} else {
				passwordFeedback.className = 'validation-feedback green';
			}

			const feedback = `Ввод содержит ${length} ${matchWord(length, 'символ', 'ов', '', 'а')}.`;
			if (length < minimumPasswordLength) {
				passwordFeedback.textContent = `${feedback} Недостаточно!`;
			} else if (length > maximumPasswordLength) {
				passwordFeedback.textContent = `${feedback} Слишком много!`;
			} else if (!availablePasswordSymbols.test(passwordInput.value)) {
				passwordFeedback.textContent = 'Пароль содержит недопустимые символы.';
			} else {
				passwordFeedback.textContent = feedback;
			}
		}
	});

	passwordInput.dispatchEvent(new Event('input'));

	messageInput.addEventListener('input', () => {
		const length = messageInput.value.length;
		if (length === 0) {
			messageFeedback.textContent = 'Поле является обязательным для заполнения.';
			messageFeedback.className = 'validation-feedback yellow';
		} else {
			const feedback = `Ввод содержит ${length} ${matchWord(length, 'символ', 'ов', '', 'а')}.`;
			if (length > settings.LENGTH_LIMIT.MESSAGE) {
				messageFeedback.textContent = `${feedback} Слишком длинное сообщение!`;
				messageFeedback.className = 'validation-feedback red';
			} else {
				messageFeedback.textContent = feedback;
				messageFeedback.className = 'validation-feedback green';
			}
		}
	});

	messageInput.dispatchEvent(new Event('input'));

	function displayServerResponse(message, IsSuccess) {
		serverResponse.textContent = message;
		serverResponse.className = IsSuccess ? 'success-message' : 'error-message';
	}

	messageForm.addEventListener('submit', async (event) => {
		event.preventDefault();

		const username = usernameInput.value.replace(/\s+/g, ' ').trim();
		const password = passwordInput.value.trim();
		const message = messageInput.value.trim();

		const minimumUsernameLength = settings.LENGTH_LIMIT.USERNAME.MINIMUM;
		const maximumUsernameLength = settings.LENGTH_LIMIT.USERNAME.MAXIMUM;
		const minimumPasswordLength = settings.LENGTH_LIMIT.PASSWORD.MINIMUM;
		const maximumPasswordLength = settings.LENGTH_LIMIT.PASSWORD.MAXIMUM;
		const limitMessageLength = settings.LENGTH_LIMIT.MESSAGE;
		const validationErrors = [];

		if (username.length === 0) {
			validationErrors.push(`Поле «Имя» является обязательным для заполнения.`);
		} else if (username.length < minimumUsernameLength) {
			validationErrors.push(`Имя пользователя должно содержать не менее ${minimumUsernameLength} ${matchWord(minimumUsernameLength, 'символ', 'ов', '', 'а')}.`);
		} else if (username.length > maximumUsernameLength) {
			validationErrors.push(`Имя пользователя должно содержать не более ${maximumUsernameLength} ${matchWord(maximumUsernameLength, 'символ', 'ов', '', 'а')}.`);
		} else if (!availableUsernameSymbols.test(username)) {
			validationErrors.push('Обнаружены недопустимые символы в имени пользователя.');
		}

		if (password.length === 0) {
			validationErrors.push(`Поле «Пароль» является обязательным для заполнения.`);
		} else if (password.length < minimumPasswordLength) {
			validationErrors.push(`Пароль должен содержать не менее ${minimumPasswordLength} ${matchWord(minimumPasswordLength, 'символ', 'ов', '', 'а')}.`);
		} else if (password.length > maximumPasswordLength) {
			validationErrors.push(`Пароль должен содержать не более ${maximumPasswordLength} ${matchWord(maximumPasswordLength, 'символ', 'ов', '', 'а')}.`);
		} else if (!availablePasswordSymbols.test(password)) {
			validationErrors.push('Обнаружены недопустимые символы в пароле.');
		}

		if (message.length === 0) {
			validationErrors.push(`Поле «Сообщение» является обязательным для заполнения.`);
		} else if (message.length > limitMessageLength) {
			validationErrors.push(`Сообщение не должно превышать ${limitMessageLength} ${matchWord(limitMessageLength, 'символ', 'ов', '', 'а')}.`);
		}

		if (validationErrors.length > 0) {
			displayServerResponse(validationErrors.join('\n'), false);
			return;
		}

		try {
			const response = await fetch('/message', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password, message })
			});
			const data = await response.json();

			if (data.SUCCESS) {
				displayServerResponse(data.MESSAGE, true);
				messageInput.value = '';
				messageInput.dispatchEvent(new Event('input'));
			}
			else if (data.VALIDATION_ERRORS && Array.isArray(data.VALIDATION_ERRORS)) {
				displayServerResponse(data.VALIDATION_ERRORS.join('\n'), false);
			} else {
				displayServerResponse(data.MESSAGE || 'Произошла ошибка при отправке сообщения.', false);
			}
		} catch (error) {
			displayServerResponse('Не удалось подключиться к серверу для отправки сообщения.', false);
		}
	});

	(async () => {
		await fetchSettings();
	})();
});