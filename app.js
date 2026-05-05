// Основной конфиг
const CONFIG = {
    CLIENT_ID: '498065444641-579mb2qst5nnpfm1caahmvmssoep4i4d.apps.googleusercontent.com',
    API_KEY: 'AIzaSyCwJDT0Nh0rguA-8gdE0XoRjZF3H_BtpZA',
    SHEET_ID: '1v_scBNE13oh5jVaOQJSzSv5kJYzZre1unkIOWitOvos',
    SHEET_NAME: 'Лист1',
}

const app = Vue.createApp({
    data() {
        return {
            isSignedIn: false,
            isAuthReady: false,
            isSaving: false,
            successMsg: '',
            errorMsg: '',
            allExpenses: [],
            categories: ['еда', 'продукты', 'алкоголь', 'красота', 'здоровье', 'спорт', 'шоппинг', 'транспорт', 'байк', 'развлечения', 'мелочи'],
            form: {
                amount: '',
                category: '',
                comment: ''
            }
        }
    },
    methods: {
        initGoogleAuth() {
            // нижнее подчёркивание в начале — это договорённость между разработчиками, означает "внутренняя переменная, не трогай снаружи". Vue её не отслеживает в отличие от data().
            this._tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CONFIG.CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/spreadsheets',
                callback: async (resp) => {
                    if (resp.error) {
                        this.errorMsg = 'Ошибка авторизации'
                        return
                    }
                    this.isSignedIn = true
                    await this.loadExpenses()
                    console.log('Вход успешен')
                },
            })
            this.isAuthReady = true
        },
        signIn() {
            this._tokenClient.requestAccessToken({ prompt: 'consent' })
        },
        signOut() {
            const token = gapi.client.getToken()
            if (token) google.accounts.oauth2.revoke(token.access_token)
            gapi.client.setToken(null)
            this.isSignedIn = false
        },

        async addExpense() {
            if (!this.form.amount || !this.form.category) return

            this.isSaving = true
            this.errorMsg = ''
            this.successMsg = ''

            try {
                await gapi.client.sheets.spreadsheets.values.append({
                    spreadsheetId: CONFIG.SHEET_ID,
                    range: `${CONFIG.SHEET_NAME}!A:D`,           // в какой лист и колонки писать
                    valueInputOption: 'RAW',        // писать как есть, без форматирования
                    resource: {
                        values: [[                    // массив строк, каждая строка — массив ячеек
                            this.todayDate,                 // A: дата
                            Number(this.form.amount),   // B: сумма
                            this.form.category,         // C: категория
                            this.form.comment,          // D: комментарий
                        ]]
                    },
                })

                this.successMsg = 'Сохранено ✓'
                this.form = { amount: '', category: '', comment: '' }
                await this.loadExpenses()
                setTimeout(() => { this.successMsg = '' }, 2500)

            } catch (e) {
                this.errorMsg = 'Ошибка: ' + e.message
            } finally {
                this.isSaving = false
            }
        },

        async loadExpenses() {
            try {
                const resp = await gapi.client.sheets.spreadsheets.values.get({
                    spreadsheetId: CONFIG.SHEET_ID,
                    range: `${CONFIG.SHEET_NAME}!A:D`,
                })

                const rows = resp.result.values || []
                // Пропускаем первую строку с заголовками
                this.allExpenses = rows.slice(1).map(row => ({
                    date:     row[0] || '',
                    amount:   row[1] || 0,
                    category: row[2] || '',
                    comment:  row[3] || '',
                }))
            } catch (e) {
                this.errorMsg = 'Ошибка загрузки: ' + e.message
            }
        },

        formatAmount(n) {
            return Number(n).toLocaleString('ru-RU')
        },
    },
    computed: {
        // Настройки для текущей даты
        today() {
            return new Date()
        },
        todayDate() {
            return this.today.toLocaleDateString('sv-SE', {
                timeZone: 'Asia/Bangkok'
            })
        },
        currentMonthName() {
            const raw = this.today.toLocaleDateString('ru-RU', {
                month: 'long',
                year: 'numeric',
            })

            return raw
                .replace(' г.', '')
                .replace(/^./, c => c.toLowerCase())
        },
        // Сортировка списка категорий по алфавиту
        sortedCategories() {
            return [...this.categories].sort((a, b) =>
                a.localeCompare(b, 'ru')
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
            return this.dailyTotals[this.todayDate] || 0
        },
        // Сумма за месяц
        monthTotal() {
            return this.allExpenses.reduce((acc, item) => {
                return acc + Number(item.amount);
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
            return this.allExpenses.filter(e => e.date === this.todayDate)
        },
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
    }
})

app.mount('#app')
