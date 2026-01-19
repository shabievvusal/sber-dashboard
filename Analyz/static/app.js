// Версия приложения
const APP_VERSION = '0.0.1';
const ANALYZ_BASE_PATH = (typeof window !== 'undefined' && window.__ANALYZ_BASE_PATH) ? window.__ANALYZ_BASE_PATH : '';

function buildAnalyzUrl(path) {
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }
    if (!ANALYZ_BASE_PATH) {
        return path;
    }
    if (path.startsWith(ANALYZ_BASE_PATH)) {
        return path;
    }
    return `${ANALYZ_BASE_PATH}${path}`;
}

class BarcodeApp {
    constructor() {
        this.baseCode = '';
        this.selectedQuantity = null;
        this.selectedCode = '';
        this.quantities = [];
        this.isDarkTheme = localStorage.getItem('darkTheme') === 'true';
        this.isProMode = localStorage.getItem('proMode') === 'true';
        this.isManualInputMode = false; // Новый режим ручного ввода
        this.manualInputHandler = null; // Обработчик для ручного ввода
        this.isPrinting = false; // Флаг для предотвращения множественных вызовов печати
        
        this.initializeElements();
        this.bindEvents();
        this.applyTheme();
        this.applyProMode();
        
        // Ensure focus at startup if PRO mode is enabled
        // В компактном режиме (iframe) не устанавливаем фокус автоматически при загрузке
        if (!this.isCompactMode) {
            this.focusInputIfPro();
        }
    }

    initializeElements() {
        this.baseCodeInput = document.getElementById('baseCode');
        this.confirmBtn = document.getElementById('confirmBtn');
        this.quantityCard = document.getElementById('quantityCard');
        this.quantityGrid = document.getElementById('quantityGrid');
        this.previewCard = document.getElementById('previewCard');
        this.previewImage = document.getElementById('previewImage');
        this.loading = document.getElementById('loading');
        this.notificationContainer = document.getElementById('notificationContainer');
        this.saveBtn = document.getElementById('saveBtn');
        this.printBtn = document.getElementById('printBtn');
        this.controlsSection = document.getElementById('controlsSection');
        this.previewSettingsBtn = document.getElementById('previewSettingsBtn');
        
        // Settings popup elements
        this.settingsPopup = document.getElementById('settingsPopup');
        this.settingsOverlay = document.getElementById('settingsOverlay');
        this.settingsClose = document.getElementById('settingsClose');
        this.settingsCancel = document.getElementById('settingsCancel');
        this.settingsSave = document.getElementById('settingsSave');
        this.darkThemeToggle = document.getElementById('darkThemeToggle');
        this.proModeToggle = document.getElementById('proModeToggle');
        this.proClock = document.getElementById('proClock');
        this.header = document.querySelector('.header');
        this.headerText = document.getElementById('headerText');
        this.printArea = document.getElementById('printArea');
        this.floatingGear = document.getElementById('floatingGear');
        this.logoIcon = document.getElementById('logoIcon');
        this.defaultPlaceholder = this.baseCodeInput ? this.baseCodeInput.placeholder : '';
        
        // Компактный режим элементы
        this.compactInputContainer = document.getElementById('compactInputContainer');
        this.compactManualBtn = document.getElementById('compactManualBtn');
        this.mainContent = document.getElementById('mainContent');
        this.isCompactMode = document.body.classList.contains('compact-mode');
    }

    bindEvents() {
        if (this.confirmBtn) {
            this.confirmBtn.addEventListener('click', () => this.confirmBaseCode());
        }
        if (this.baseCodeInput) {
            this.baseCodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    if (this.isManualInputMode) {
                        this.handleManualInput();
                    } else {
                        this.confirmBaseCode();
                    }
                }
            });
            if (!this.isCompactMode) {
                this.baseCodeInput.addEventListener('blur', () => {
                    // Small delay so click handlers can finish, then refocus
                    setTimeout(() => this.focusInputIfPro(), 0);
                });
            }
        }
        
        // Кнопка ручного ввода в компактном режиме
        if (this.compactManualBtn) {
            this.compactManualBtn.addEventListener('click', () => this.toggleManualInputMode());
        }
        if (this.saveBtn) {
            this.saveBtn.addEventListener('click', () => this.saveBarcode());
        }
        if (this.printBtn) {
            this.printBtn.addEventListener('click', () => this.printBarcode());
        }
        if (this.previewSettingsBtn) {
            this.previewSettingsBtn.addEventListener('click', () => this.togglePreviewSettings());
        }
        
        // Settings popup events (могут отсутствовать в компактном режиме)
        if (this.settingsClose) {
            this.settingsClose.addEventListener('click', () => this.hideSettings());
        }
        if (this.settingsCancel) {
            this.settingsCancel.addEventListener('click', () => this.hideSettings());
        }
        if (this.settingsSave) {
            this.settingsSave.addEventListener('click', () => this.saveSettings());
        }
        if (this.settingsOverlay) {
            this.settingsOverlay.addEventListener('click', () => this.hideSettings());
        }
        if (this.darkThemeToggle) {
            this.darkThemeToggle.addEventListener('click', () => this.toggleDarkTheme());
        }
        if (this.proModeToggle) {
            this.proModeToggle.addEventListener('click', () => this.toggleProMode());
        }
        if (this.floatingGear) {
            this.floatingGear.addEventListener('click', () => this.showSettings());
        }
        if (this.logoIcon) {
            this.logoIcon.addEventListener('click', () => this.toggleManualInputMode());
        }

        // Keep focus in PRO mode on various events
        // В компактном режиме (iframe) не устанавливаем фокус автоматически, чтобы не мешать работе с другими окнами
        if (!this.isCompactMode) {
            document.addEventListener('visibilitychange', () => this.focusInputIfPro());
            document.addEventListener('click', (e) => {
                // Устанавливаем фокус только если клик был внутри этого документа (не в родительском окне)
                if (e.target && document.contains(e.target)) {
                    this.focusInputIfPro();
                }
            });
        }
    }

    focusInputIfPro() {
        // В компактном режиме (встроенный iframe) НЕ устанавливаем фокус автоматически,
        // чтобы не мешать работе с другими окнами/полями ввода
        // Фокус устанавливается только когда пользователь явно кликает на поле ввода
        if (this.isCompactMode) {
            return;
        }
        if (!this.isProMode && !this.isManualInputMode) return;
        if (!this.baseCodeInput) return;
        try {
            if (document.activeElement !== this.baseCodeInput) {
                this.baseCodeInput.focus();
                // Place caret at end for scanners that append
                const val = this.baseCodeInput.value;
                this.baseCodeInput.setSelectionRange(val.length, val.length);
            }
        } catch (_) {}
    }

    showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = 'notification notification-' + type;
        
        // Иконки для разных типов уведомлений
        const icons = {
            success: 'fas fa-check',
            error: 'fas fa-times',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        notification.innerHTML = '<div class="notification-icon"><i class="' + icons[type] + '"></i></div><div class="notification-content">' + message + '</div><button class="notification-close"><i class="fas fa-times"></i></button><div class="notification-progress"></div>';
        
        // Добавляем обработчик закрытия
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => this.hideNotification(notification));
        
        // Добавляем в контейнер
        this.notificationContainer.appendChild(notification);
        
        // Анимация появления
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Прогресс-бар
        const progressBar = notification.querySelector('.notification-progress');
        progressBar.style.width = '100%';
        progressBar.style.transitionDuration = duration + 'ms';
        
        // Автоматическое скрытие
        setTimeout(() => {
            this.hideNotification(notification);
        }, duration);
    }
    
    hideNotification(notification) {
        notification.classList.remove('show');
        notification.classList.add('hide');
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }

    showLoading(show = true) {
        this.loading.style.display = show ? 'block' : 'none';
    }

    // Отправка сообщения родительскому окну для изменения размера iframe
    notifyParentResize(height) {
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({
                    type: 'barcode-resize',
                    height: height
                }, '*'); // Используем '*' для простоты, можно ограничить origin
            } catch (e) {
                console.log('Не удалось отправить сообщение родительскому окну:', e);
            }
        }
    }

    async confirmBaseCode() {
        this.baseCode = this.baseCodeInput.value.trim();
        if (!this.baseCode) {
            this.showNotification('Введите штрих-код товара', 'error');
            this.focusInputIfPro();
            return;
        }

        this.showLoading(true);
        try {
            const response = await fetch(buildAnalyzUrl(`/barcode/api/search?query=${encodeURIComponent(this.baseCode)}`), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                cache: 'no-store'
            });

            const data = await response.json();
            if (data.found) {
                // Показать все доступные количества из группы (уникальные, по возрастанию)
                this.quantities = Array.from(new Set(data.products.map(p => p.quantity))).sort((a, b) => a - b);
                
                this.renderQuantities();
                this.quantityCard.classList.remove('hidden');
                this.quantityCard.classList.add('fade-in');
                
                // В компактном режиме показываем основной контент
                if (this.isCompactMode && this.mainContent) {
                    this.mainContent.classList.remove('compact-hidden');
                    if (this.compactInputContainer) {
                        this.compactInputContainer.style.display = 'none';
                    }
                }
                
                // Увеличиваем iframe при появлении выбора количества
                this.notifyParentResize('expand');
                
                let statusMessage = 'Выберите количество из списка';
                this.showNotification(statusMessage, 'success');
            } else {
                this.showNotification('Штрих-код не найден', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        } finally {
            this.showLoading(false);
            this.focusInputIfPro();
        }
    }

    renderQuantities() {
        this.quantityGrid.innerHTML = '';
        this.quantities.forEach(qty => {
            const btn = document.createElement('div');
            btn.className = 'quantity-btn';
            btn.innerHTML = '📦 ' + qty + ' шт';
            
            // Передаём и элемент, и значение количества
            btn.addEventListener('click', (e) => this.selectQuantity(qty, e.currentTarget));
            this.quantityGrid.appendChild(btn);
        });
        this.focusInputIfPro();
    }

    selectQuantity(quantity, buttonElement) {
        document.querySelectorAll('.quantity-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        if (buttonElement) {
            buttonElement.classList.add('active');
        }
        
        this.selectedQuantity = quantity;
        this.generateBarcode();
        
        // Автопечать для PRO режима или компактного режима (оператор/менеджер)
        if (this.isProMode || this.isCompactMode) {
            setTimeout(() => {
                this.printBarcode();
            }, 600);
        }
        // В обычном режиме печать происходит только по кнопке "Печать"
    }

    async generateBarcode() {
        if (!this.baseCode || !this.selectedQuantity) return;

        this.showLoading(true);
        try {
            const response = await fetch(buildAnalyzUrl('/barcode/api/generate-barcode'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                cache: 'no-store',
                body: JSON.stringify({
                    base_code: this.baseCode,
                    quantity: this.selectedQuantity,
                })
            });

            const data = await response.json();
            if (data.success && data.image) {
                this.selectedCode = data.barcode_string;
                
                if (this.previewImage) {
                    this.previewImage.src = data.image;
                }
                if (this.previewCard) {
                    this.previewCard.classList.remove('hidden');
                    this.previewCard.classList.add('fade-in');
                }
                if (this.controlsSection) {
                    this.controlsSection.classList.remove('hidden');
                    this.controlsSection.classList.add('fade-in');
                }
                
                // В компактном режиме показываем основной контент при появлении предпросмотра
                if (this.isCompactMode && this.mainContent) {
                    this.mainContent.classList.remove('compact-hidden');
                    if (this.compactInputContainer) {
                        this.compactInputContainer.style.display = 'none';
                    }
                }
                
                // Увеличиваем iframe при появлении предпросмотра
                this.notifyParentResize('expand');
                
                // Отображаем название продукта
                const productNameElement = document.getElementById('productName');
                if (productNameElement) {
                    if (data.product_name) {
                        productNameElement.textContent = data.product_name;
                        productNameElement.style.display = 'block';
                    } else {
                        productNameElement.style.display = 'none';
                    }
                }
                
                this.showNotification('Штрих-код сгенерирован', 'success');
            } else {
                if (this.previewImage) this.previewImage.src = '';
                if (this.previewCard) this.previewCard.classList.add('hidden');
                if (this.controlsSection) this.controlsSection.classList.add('hidden');
                this.selectedCode = '';
                
                // Скрываем название продукта при ошибке
                const productNameElement = document.getElementById('productName');
                if (productNameElement) {
                    productNameElement.style.display = 'none';
                }
                
                this.showNotification(data.message || 'Ошибка генерации штрих-кода', 'error');
            }
        } catch (error) {
            if (this.previewImage) this.previewImage.src = '';
            if (this.previewCard) this.previewCard.classList.add('hidden');
            if (this.controlsSection) this.controlsSection.classList.add('hidden');
            this.selectedCode = '';
            this.showNotification('Ошибка соединения с сервером', 'error');
        } finally {
            this.showLoading(false);
            this.focusInputIfPro();
        }
    }

    togglePreviewSettings() {
        // Переключаем только блок настроек (шкала размера)
        if (!this.controlsSection) return;
        if (this.controlsSection.classList.contains('hidden')) {
            this.controlsSection.classList.remove('hidden');
            this.controlsSection.classList.add('fade-in');
        } else {
            this.controlsSection.classList.add('hidden');
        }
        this.focusInputIfPro();
    }

    async saveBarcode() {
        if (!this.baseCode || !this.selectedQuantity) {
            this.showNotification('Сначала сгенерируйте штрих-код', 'error');
            this.focusInputIfPro();
            return;
        }

        this.showLoading(true);
        try {
            const response = await fetch(buildAnalyzUrl('/barcode/api/save-barcode'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                cache: 'no-store',
                body: JSON.stringify({
                    base_code: this.baseCode,
                    quantity: this.selectedQuantity,
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'barcode_' + this.selectedCode + '.png';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                this.showNotification('Файл сохранен', 'success');
            } else {
                const data = await response.json();
                this.showNotification(data.message || 'Ошибка сохранения', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        } finally {
            this.showLoading(false);
            this.focusInputIfPro();
        }
    }

    printBarcode() {
        console.log('printBarcode вызван');
        
        // Защита от множественных вызовов
        if (this.isPrinting) {
            console.log('Печать уже выполняется, пропускаем');
            return;
        }
        
        if (!this.previewImage || !this.previewImage.src) {
            this.showNotification('Сначала сгенерируйте штрих-код', 'error');
            this.focusInputIfPro();
            return;
        }
        
        console.log('previewImage.src:', this.previewImage.src);
        
        this.isPrinting = true;

        // Создаем новый элемент изображения с правильным src
        const printImage = document.createElement('img');
        printImage.src = this.previewImage.src;
        printImage.alt = 'Штрих-код для печати';
        printImage.style.cssText = `
            width: 52%;
            height: auto;
            max-width: 10cm;
            max-height: 7cm;
            display: block;
            margin: 0 auto;
        `;
        
        // Создаем элемент для названия продукта
        const productNameElement = document.getElementById('productName');
        const printProductName = document.createElement('div');
        if (productNameElement && productNameElement.textContent && productNameElement.textContent.trim()) {
            printProductName.textContent = productNameElement.textContent;
            printProductName.style.cssText = `
                text-align: center;
                font-size: 12px;
                font-weight: 500;
                color: #000;
                margin-top: 4px;
                padding: 2px 4px;
                max-width: 100%;
                word-wrap: break-word;
                display: block;
                width: 75%;
            `;
        }

        // Создаем контейнер для печати (скрытый)
        const printContainer = document.createElement('div');
        printContainer.id = 'print-container';
        printContainer.style.cssText = `
            position: fixed;
            top: -10000px;
            left: -10000px;
            width: 10.5cm;
            height: 7.5cm;
            background: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        `;
        
        printContainer.appendChild(printImage);
        if (productNameElement && productNameElement.textContent) {
            printContainer.appendChild(printProductName);
        }
        document.body.appendChild(printContainer);
        
        // Добавляем CSS для печати
        const printStyles = document.createElement('style');
        printStyles.id = 'print-styles';
        printStyles.textContent = `
            @media print {
                body * {
                    visibility: hidden !important;
                }
                #print-container,
                #print-container * {
                    visibility: visible !important;
                }
                #print-container {
                    position: absolute !important;
                    left: 0 !important;
                    top: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }
                @page {
                    size: 10.5cm 7.5cm;
                    margin: 0;
                }
            }
        `;
        document.head.appendChild(printStyles);
        
        // Простая логика - сразу запускаем печать
        console.log('Запускаем печать сразу');
        this.startPrint();
    }

    startPrint() {
        console.log('Запускаем печать');
        
        // Добавляем обработчик для очистки после печати
        const cleanupAfterPrint = () => {
            console.log('Очистка после печати');
            this.cleanupPrint();
            window.removeEventListener('afterprint', cleanupAfterPrint);
        };
        
        window.addEventListener('afterprint', cleanupAfterPrint);
        
        // Запускаем печать сразу
        console.log('Вызываем window.print()');
        window.print();
        
        // Резервная очистка через 3 секунды
        setTimeout(() => {
            console.log('Резервная очистка');
            cleanupAfterPrint();
        }, 3000);
    }

    cleanupPrint() {
        const printContainer = document.getElementById('print-container');
        const printStyles = document.getElementById('print-styles');
        
        if (printContainer) {
            document.body.removeChild(printContainer);
        }
        if (printStyles) {
            document.head.removeChild(printStyles);
        }
        
        // Сбрасываем флаг печати
        this.isPrinting = false;
        
        // Уменьшаем iframe после печати
        this.notifyParentResize('collapse');
        
        // Очищаем поле ввода и скрываем карточки
        if (this.baseCodeInput) {
            this.baseCodeInput.value = '';
        }
        this.baseCode = '';
        this.selectedQuantity = null;
        if (this.quantityCard) {
            this.quantityCard.classList.add('hidden');
        }
        if (this.previewCard) {
            this.previewCard.classList.add('hidden');
        }
        if (this.controlsSection) {
            this.controlsSection.classList.add('hidden');
        }
        
        // В компактном режиме возвращаемся к простому вводу
        if (this.isCompactMode) {
            if (this.mainContent) {
                this.mainContent.classList.add('compact-hidden');
            }
            if (this.compactInputContainer) {
                this.compactInputContainer.style.display = 'flex';
            }
        }
        
        this.focusInputIfPro();
    }


    showSettings() {
        if (!this.settingsOverlay || !this.settingsPopup) return;
        this.settingsOverlay.classList.add('show');
        this.settingsPopup.classList.add('show');
        if (this.darkThemeToggle) {
            this.darkThemeToggle.classList.toggle('active', this.isDarkTheme);
        }
        if (this.proModeToggle) {
            this.proModeToggle.classList.toggle('active', this.isProMode);
        }
        this.focusInputIfPro();
    }

    hideSettings() {
        if (!this.settingsOverlay || !this.settingsPopup) return;
        this.settingsOverlay.classList.remove('show');
        this.settingsPopup.classList.remove('show');
        this.focusInputIfPro();
    }

    toggleDarkTheme() {
        this.isDarkTheme = !this.isDarkTheme;
        if (this.darkThemeToggle) {
            this.darkThemeToggle.classList.toggle('active', this.isDarkTheme);
        }
        this.focusInputIfPro();
    }

    applyTheme() {
        if (this.isDarkTheme) {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }

    saveSettings() {
        localStorage.setItem('darkTheme', this.isDarkTheme);
        localStorage.setItem('proMode', this.isProMode);
        this.applyTheme();
        this.applyProMode();
        this.hideSettings();
        this.showNotification('Настройки сохранены', 'success');
        this.focusInputIfPro();
    }

    toggleProMode() {
        this.isProMode = !this.isProMode;
        if (this.proModeToggle) {
            this.proModeToggle.classList.toggle('active', this.isProMode);
        }
        this.applyProMode();
        this.focusInputIfPro();
    }

    applyProMode() {
        if (this.isProMode) {
            document.body.classList.add('pro-mode');
            this.startProClock();
            if (this.baseCodeInput) {
                this.baseCodeInput.placeholder = 'Отсканируй ШК';
            }
        } else {
            document.body.classList.remove('pro-mode');
            this.stopProClock();
            if (this.baseCodeInput) {
                this.baseCodeInput.placeholder = this.defaultPlaceholder || 'Введите штрих-код товара';
            }
        }
        this.focusInputIfPro();
    }

    startProClock() {
        const update = () => {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
            if (this.proClock) this.proClock.textContent = time;
        };
        update();
        if (this.clockTimer) clearInterval(this.clockTimer);
        this.clockTimer = setInterval(update, 1000);
    }

    stopProClock() {
        if (this.clockTimer) clearInterval(this.clockTimer);
        this.clockTimer = null;
        if (this.proClock) this.proClock.textContent = '';
    }

    toggleManualInputMode() {
        if (!this.baseCodeInput) return;
        this.isManualInputMode = !this.isManualInputMode;
        
        if (this.isManualInputMode) {
            // Включаем режим ручного ввода
            this.baseCodeInput.placeholder = 'Введите ШК вручную';
            this.baseCodeInput.focus();
            this.showNotification('Режим ручного ввода включен', 'info');
            
            // Добавляем визуальную индикацию
            this.baseCodeInput.style.borderColor = '#f59e0b';
            this.baseCodeInput.style.backgroundColor = '#fef3c7';
            this.baseCodeInput.style.color = '#000000';
            
            // В компактном режиме подсвечиваем кнопку
            if (this.compactManualBtn) {
                this.compactManualBtn.classList.add('active');
            }
            
            // Удаляем старый обработчик Enter если он есть
            this.baseCodeInput.removeEventListener('keypress', this.manualInputHandler);
            
            // Создаем новый обработчик Enter для немедленной печати
            this.manualInputHandler = (e) => {
                if (e.key === 'Enter') {
                    this.handleManualInput();
                }
            };
            this.baseCodeInput.addEventListener('keypress', this.manualInputHandler);
        } else {
            // Отключаем режим ручного ввода
            this.baseCodeInput.placeholder = this.defaultPlaceholder;
            this.showNotification('Режим ручного ввода отключен', 'info');
            
            // Убираем визуальную индикацию
            this.baseCodeInput.style.borderColor = '';
            this.baseCodeInput.style.backgroundColor = '';
            this.baseCodeInput.style.color = '';
            
            // В компактном режиме убираем подсветку кнопки
            if (this.compactManualBtn) {
                this.compactManualBtn.classList.remove('active');
            }
            
            // Удаляем обработчик ручного ввода
            if (this.manualInputHandler) {
                this.baseCodeInput.removeEventListener('keypress', this.manualInputHandler);
                this.manualInputHandler = null;
            }
        }
    }

    async handleManualInput() {
        const barcode = this.baseCodeInput.value.trim();
        if (!barcode) {
            this.showNotification('Введите штрих-код', 'error');
            return;
        }

        this.showLoading(true);
        try {
            // При ручном вводе печатаем именно то, что ввел пользователь
            await this.generateAndPrintBarcodeDirect(barcode);
        } catch (error) {
            this.showNotification('Ошибка генерации штрих-кода', 'error');
        } finally {
            this.showLoading(false);
            this.baseCodeInput.value = '';
            this.focusInputIfPro();
        }
    }

    async generateAndPrintBarcode(baseCode, quantity) {
        try {
            const response = await fetch(buildAnalyzUrl('/barcode/api/generate-barcode'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                cache: 'no-store',
                body: JSON.stringify({
                    base_code: baseCode,
                    quantity: quantity,
                })
            });

            const data = await response.json();
            if (data.success && data.image) {
                this.selectedCode = data.barcode_string;
                
                // Сразу печатаем
                setTimeout(() => {
                    this.printBarcode();
                }, 500);
                
                this.showNotification('Штрих-код сгенерирован и отправлен на печать', 'success');
            } else {
                this.showNotification(data.message || 'Ошибка генерации штрих-кода', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка генерации штрих-кода', 'error');
        }
    }

    async generateAndPrintBarcodeDirect(barcode) {
        try {
            // Генерируем штрих-код напрямую через внешний сервис
            const barcodeUrl = `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(barcode)}&code=Code128&dpi=150&format=PNG`;
            
            // Устанавливаем изображение для печати
            if (this.previewImage) {
                this.previewImage.src = barcodeUrl;
            }
            this.selectedCode = barcode;
            
            if (this.previewCard) {
                this.previewCard.classList.remove('hidden');
                this.previewCard.classList.add('fade-in');
            }
            if (this.controlsSection) {
                this.controlsSection.classList.remove('hidden');
                this.controlsSection.classList.add('fade-in');
            }
            
            // Сразу печатаем
            setTimeout(() => {
                this.printBarcode();
            }, 500);
            
            this.showNotification('Штрих-код сгенерирован и отправлен на печать', 'success');
        } catch (error) {
            this.showNotification('Ошибка генерации штрих-кода', 'error');
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new BarcodeApp();
});

