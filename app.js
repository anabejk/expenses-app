// Основной конфиг
const CONFIG = {
    CLIENT_ID: '498065444641-579mb2qst5nnpfm1caahmvmssoep4i4d.apps.googleusercontent.com',
    API_KEY: 'AIzaSyCwJDT0Nh0rguA-8gdE0XoRjZF3H_BtpZA',
    SHEET_ID: '1v_scBNE13oh5jVaOQJSzSv5kJYzZre1unkIOWitOvos',
    SHEET_NAME: 'Все расходы',
}

const app = Vue.createApp({
    data() {
        return {
            isSignedIn: false,
            isAuthReady: false,
            isSaving: false,
            sessionExpired: false,
            successMsg: '',
            errorAlert: null,
            allExpenses: [],
            categories: ['еда', 'продукты', 'алкоголь', 'красота', 'здоровье', 'спорт', 'шоппинг', 'транспорт', 'байк', 'развлечения', 'мелочи', 'стирка', 'быт'],
            newCategory: '',
            form: {
                date: '',
                amount: 0,
                category: '',
                comment: ''
            },
            amountError: false,
            openNewCategory: false,
            isMonthDetails: false,
            monthLimit: 55000,
            selectedMonth: '',
            selectedMonthName: '',
            availableMonths: [],
            isHomeOpen: true,
            isFormOpen: false,
            isTotalOpen: false
        }
    },
    methods: {
        initGoogleAuth() {
            // нижнее подчёркивание в начале — это договорённость между разработчиками, означает "внутренняя переменная, не трогай снаружи". Vue её не отслеживает в отличие от data().
            this._tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CONFIG.CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/spreadsheets',
                prompt: '',
                callback: async (resp) => {
                    if (resp.error) {
                        this.errorAlert = this.getReadableError(e)
                        return
                    }
                    // Сохраняем токен в localStorage
                    const token = gapi.client.getToken()
                    localStorage.setItem('gapi_token', JSON.stringify(token))
                    console.log('Токен для входа получен')
                    this.isSignedIn = true
                    await this.loadExpenses()
                    console.log('Вход успешен')
                },
            })
            this.isAuthReady = true
        },
        signIn() {
            this._tokenClient.requestAccessToken({ prompt: '' })
            this.errorAlert = null
        },
        signOut() {
            const token = gapi.client.getToken()
            if (token) google.accounts.oauth2.revoke(token.access_token)
            gapi.client.setToken(null)
            localStorage.removeItem('gapi_token')
            this.isSignedIn = false
            this.sessionExpired = false
        },
        async apiRequest(requestFn) {
            try {
                // Пробуем выполнить запрос
                return await requestFn()
            } catch (e) {
                // Если токен протух — показываем баннер с кнопкой
                if (e.status === 401) {
                    this.sessionExpired = true
                    this.isSignedIn = false
                    throw e
                }
                throw e
            }
        },
        // Редактирование и получение данных с Google таблицы
        async addExpense() {
            if (!this.form.amount || !this.form.category) return

            this.isSaving = true
            this.errorAlert = null
            this.successMsg = ''

            try {
                await this.apiRequest(() =>
                    gapi.client.sheets.spreadsheets.values.append({
                        spreadsheetId: CONFIG.SHEET_ID,
                        range: `${CONFIG.SHEET_NAME}!A:D`,  // в какой лист и колонки писать
                        valueInputOption: 'RAW',            // писать как есть, без форматирования
                        resource: {                         // массив строк, каждая строка — массив ячеек
                            values: [[
                                this.form.date,            // A: дата
                                this.form.amount,          // B: сумма
                                this.form.category,        // C: категория
                                this.form.comment,         // D: комментарий
                            ]]
                        },
                    })
                )

                this.successMsg = 'Сохранено ✓'
                this.form = { date: this.form.date, amount: 0, category: '', comment: '' }
                await this.loadExpenses()

            } catch (e) {
                this.errorAlert = this.getReadableError(e)
            } finally {
                this.successMsg = ''
                this.isSaving = false
            }
        },
        async loadExpenses() {
            try {
                const resp = await this.apiRequest(() =>
                    gapi.client.sheets.spreadsheets.values.get({
                        spreadsheetId: CONFIG.SHEET_ID,
                        range: `${CONFIG.SHEET_NAME}!A:D`,
                    })
                )

                const rows = resp.result.values || []
                // Пропускаем первую строку с заголовками
                this.allExpenses = rows.slice(1).map((row, index) => ({
                    rowIndex: index + 1,
                    date:     row[0] || '',
                    amount:   row[1] || 0,
                    category: row[2] || '',
                    comment:  row[3] || '',
                }))

                await this.loadAvailableMonths();

            } catch (e) {
                this.errorAlert = this.getReadableError(e)
                throw e
            }
        },
        async deleteExpense(expense) {
            const confirmed = confirm(
                `Удалить "${expense.category}" • ${expense.amount} ฿ ?`
            )
            if (!confirmed) return

            console.group('Удаляем...')

            console.log('Строка в Google:', expense.rowIndex)
            console.log('Дата:', expense.date)
            console.log('Сумма:', expense.amount)
            console.log('Категория:', expense.category)
            console.log('Комментарий:', expense.comment)

            console.groupEnd()

            try {
                await this.apiRequest(() =>
                    gapi.client.sheets.spreadsheets.batchUpdate({
                        spreadsheetId: CONFIG.SHEET_ID,

                        resource: {
                            requests: [
                                {
                                    deleteDimension: {
                                        range: {
                                            sheetId: 0,
                                            dimension: 'ROWS',

                                            startIndex: expense.rowIndex,
                                            endIndex: expense.rowIndex + 1
                                        }
                                    }
                                }
                            ]
                        }
                    })
                )
                console.log('Трата удалена!')

                await this.loadExpenses()

            } catch (error) {
                this.errorAlert = this.getReadableError(error)
            }
        },
        async loadAvailableMonths() {
            console.log('=== Начинаем loadAvailableMonths ===');
            console.log('Всего расходов в allExpenses:', this.allExpenses.length);

            let months = []

            this.allExpenses.forEach((exp, index) => {
                if (exp.date && exp.date.length >= 7) {
                    const monthKey = exp.date.substring(0, 7)

                    if (!months.includes(monthKey)) {
                        months.push(monthKey);
                        console.log(`   → Добавлен новый месяц: ${monthKey}`);
                    }
                }
            })
            console.log('Месяцы перед сортировкой:', months);
            months.sort().reverse()
            console.log('Месяцы после сортировки:', months);

            this.availableMonths = months.map(value => {
                const [year, month] = value.split('-')
                const date = new Date(year, parseInt(month) - 1)

                return {
                    value: value,
                    label: date.toLocaleDateString('ru-RU', {
                        month: 'long',
                        year: 'numeric'
                    }).replace(' г.', '')
                }
            })

            console.log('Итоговый availableMonths перед проверкой на новый месяц:', this.availableMonths);


            if(!this.availableMonths.some(m => m.value === this.todayMonthKey )) {
                this.availableMonths.unshift({
                    value: this.todayMonthKey,
                    label: this.todayMonthName
                })
                console.log('Итоговый availableMonths после проверки на новый месяц:', this.availableMonths);
            }

            this.selectedMonth = this.availableMonths[0].value;
            this.selectedMonthName = this.availableMonths[0].label;

            console.log(this.selectedMonth)
            console.log('=== loadAvailableMonths завершён ===');
        },

        formatAmount(n) {
            return n.toLocaleString('ru-RU')
        },
        inputValidation(){
            if (typeof this.form.amount !== 'number') {
                console.log('Это не число!')
                this.amountError = true
            } else {
                this.amountError = false
            }
        },
        openTabCategory() {
            if (this.openNewCategory) {
                this.openNewCategory = false
            } else {
                this.openNewCategory = true
            }
        },
        addNewCategory() {
            const category = this.newCategory.trim()

            if (!category) return
            console.log(category)

            if (this.categories.includes(category)) {
                this.form.category = category
                this.newCategory = ''
                return
            }
            this.categories.push(category)

            this.form.category = category

            this.newCategory = ''
            this.openNewCategory = false
        },
        toggleMonthDetails() {
            this.isMonthDetails = !this.isMonthDetails
        },
        // Цвет для сумм по дням
        daysColorClass(value) {
            if (value <= 1500) return 'color-green'
            if (value > 1500 && value <= 3000) return 'color-yellow'
            return 'color-red'
        },

        getReadableError(error) {
            const code = error?.status || error?.result?.error?.code

            switch (code) {
                case 401:
                    return {
                        title: 'Сессия истекла',
                        status: 401,
                        message: 'Нужно войти заново'
                    }

                case 403:
                    return {
                        title: 'Нет доступа',
                        status: 403,
                        message: 'Проверьте Google аккаунт'
                    }

                case 404:
                    return {
                        title: 'Таблица не найдена',
                        status: 404,
                        message: 'Проверьте настройки приложения'
                    }

                case 429:
                    return {
                        title: 'Слишком много запросов',
                        status: 429,
                        message: 'Попробуйте через несколько секунд'
                    }

                case 500:
                case 503:
                    return {
                        title: 'Сервис временно недоступен',
                        status: code,
                        message: 'Попробуйте позже'
                    }

                default:
                    return {
                        title: 'Что-то пошло не так',
                        status: code || 'неизвестная ошибка',
                        message: 'Попробуйте повторить действие'
                    }
            }
        },
        changeMonth(){
            console.log(this.selectedMonth)
            this.selectedMonthName = this.availableMonths.find(m => m.value === this.selectedMonth).label
        },
        openHome() {
            this.isHomeOpen = true
            this.isFormOpen = false
            this.isTotalOpen = false
        },
        openForm() {
            this.isFormOpen = true
            this.isHomeOpen = false
            this.isTotalOpen = false
            this.form.date = this.todayFullDate
        },
        openTotal() {
            this.isTotalOpen = true
            this.isHomeOpen = false
            this.isFormOpen = false
        }
    },
    computed: {
        // Настройки для текущей даты по тайм-зоне Бангкока
        today() {
            const now = new Date()
            return new Date(now.toLocaleString('en-US', {
                timeZone: 'Asia/Bangkok'
            }))
        },
        //Дата в формате YYYY-MM-DD которую мы устанавливаем по умолчанию (тайм-зона Бангкок)
        todayFullDate() {
            const now = new Date()
            return now.toLocaleDateString('sv-SE', {
                timeZone: 'Asia/Bangkok'
            })
        },
        //Текущий год и месяц в формате YYYY-MM (тайм-зона Бангкок)
        todayMonthKey() {
            const year = this.today.getFullYear()
            const month = String(this.today.getMonth() + 1).padStart(2, '0')
            return `${year}-${month}`
        },
        //Текущий год и месяц в формате month YYYY (тайм-зона Бангкок)
        todayMonthName() {
            const raw = this.today.toLocaleDateString('ru-RU', {
                month: 'long',
                year: 'numeric',
            })
            return raw
                .replace(' г.', '')
                .replace(/^./, c => c.toLowerCase())
        },
        //Текущий день и месяц в формате day, month (тайм-зона Бангкок)
        currentDayName() {
            const [ year, month, day ] = this.form.date.split('-').map(Number)
            return new Date (year, month - 1, day).toLocaleDateString('ru-RU', {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
            })
        },
        daysPassed() {
            return this.today.getDate()
        },
        getDaysInMonth() {
            const [ year, month ] = this.selectedMonth.split('-').map(Number)
            return new Date(year, month, 0).getDate()
        },
        // Сортировка списка категорий по алфавиту
        sortedCategories() {
            return [...this.categories].sort((a, b) =>
                a.localeCompare(b, 'ru')
            );
        },
        // Фильтр расходов в зависимости от выбраного месяца (текущий по умолчанию)
        filteredExpenses() {
            if (!this.selectedMonth) return this.allExpenses;

            return this.allExpenses.filter(exp =>
                exp.date && exp.date.startsWith(this.selectedMonth)
            );
        },
        // Группировка всех трат по датам и подсчёт суммы за каждый день
        dailyTotals() {
            const map = {}

            this.allExpenses.forEach(e => {
                const date = e.date

                const amount = Number(e.amount)

                const dateAlreadyExists = map[date]

                if (!dateAlreadyExists) {
                    // Если эту дату видим впервые — создаём её с нулём
                    map[date] = 0
                }
                // Прибавляем сумму к накопленному итогу за этот день
                map[date] = map[date] + amount
            })
            return map
            // Результат выглядит так:
            // { '2026-05-01': 1200, '2026-05-02': 3500, ... }
        },
        // Сумма за сегодня
        todayTotal() {
            return this.dailyTotals[this.form.date] || 0
        },
        // Сумма за месяц
        monthTotal() {
            return this.filteredExpenses.reduce((acc, item) => {
                return acc + Number(item.amount || 0 );
            }, 0);
        },
        // Цвет для сегодняшней суммы
        todayColorClass() {
            if (this.todayTotal <= 1500) return 'color-green'
            if (this.todayTotal <= 3000) return 'color-yellow'
            return 'color-red'
        },
        // Все расходы сегодня детально
        todayExpenses() {
            return this.allExpenses.filter(e => e.date === this.form.date)
        },
        // Цвет прогресс-бара
        progressColor() {
            // Сколько процентов бюджета уже потрачено
            const spentPercent = (this.monthTotal / this.monthLimit) * 100

            if (spentPercent <= 40) {
                return 'prog-green'
            } else if (spentPercent <= 80) {
                return 'prog-yellow'
            } else {
                return 'prog-red'
            }
        },
        // Статистика дней
        greenDays() {
            return Object.values(this.dailyTotals).filter(n => n <= 1500).length
        },
        yellowDays() {
            return Object.values(this.dailyTotals).filter(n => n > 1500 && n <= 3000).length
        },
        redDays() {
            return Object.values(this.dailyTotals).filter(n => n > 3000).length
        },
        // Кнопка посмотреть все траты за месяц
    },
    async mounted() {
        // Загружаем клиент Google API
        await new Promise (function (resolve, reject){
            gapi.load('client', resolve)
        })

        // Инициализируем его с нашим API ключом
        await gapi.client.init({
            apiKey: CONFIG.API_KEY,
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
        })

        // Запускаем авторизацию
        this.initGoogleAuth()

        // Проверяем есть ли сохранённый токен
        const savedToken = localStorage.getItem('gapi_token')
        if (savedToken) {
            gapi.client.setToken(JSON.parse(savedToken))
            console.log('Проверяем есть ли сохранённый токен...')
            try {
                // Пробуем загрузить данные — если токен протух словим 401
                this.isSignedIn = true
                await this.loadExpenses()
                console.log('Сохраненный токен подходит :)')
            } catch (e) {
                // Токен протух — показываем окно обновления
                console.log('Токен протух - показываем окно обновления')

                // Обработка ошибки
                this.errorAlert = this.getReadableError(e)

                this.isSignedIn = false
                this.sessionExpired = true
            }
        }

        // Когда computed уже доступны — устанавливаем дату
        this.form.date = this.todayFullDate

        //Отладка
        console.log('Дата в формате YYYY-MM-DD которую мы устанавливаем по умолчанию: ', this.todayFullDate)
        console.log('Текущий год и месяц в формате YYYY-MM: ', this.todayMonthKey)
        this.loadAvailableMonths()
        console.log('Стартовый месяц для подсчета: ',typeof this.selectedMonth)
        console.log('Сумма за день', this.dailyTotals)
    }
})

app.mount('#app')
