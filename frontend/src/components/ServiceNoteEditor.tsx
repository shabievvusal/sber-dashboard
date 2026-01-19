import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

interface Employee {
  code: string;
  company: string;
  name: string;
  assignment: string;
}

interface Company {
  id: number;
  name: string;
}

interface Reason {
  id: string;
  fullText: string;
  shortText: string;
}

const REASONS: Reason[] = [
  { id: '1', fullText: '1. **Нарушение формирования отправления** (создание излишка, недостачи, пересорта).', shortText: 'Нарушение формирования отправления' },
  { id: '2', fullText: '2. **Нарушение правил упаковки**.', shortText: 'Нарушение правил упаковки' },
  { id: '3', fullText: '3. **Прикрепление на поверхность отправления не соответствующей графической информации** (этикетки/стикера со штриховым кодом), предназначенной для автоматизированной идентификации и учёта отправления (RP).', shortText: 'Прикрепление на поверхность отправления не соответствующей графической информации' },
  { id: '4', fullText: '4. **Некорректный подсчет товара при проведении инвентаризации**.', shortText: 'Некорректный подсчет товара при проведении инвентаризации' },
  { id: '5', fullText: '5. **Отсутствие, повреждение, исключающее возможность использования или утрата пропуска**.', shortText: 'Отсутствие, повреждение, исключающее возможность использования или утрата пропуска' },
  { id: '5.1', fullText: '   5.1 **Передача пропуска третьим лицам**.', shortText: 'Передача пропуска третьим лицам' },
  { id: '6', fullText: '6. **Оказание услуг в состоянии алкогольного, наркотического опьянения, а также употребление/хранение алкогольных напитков, наркотических средств, психотропных веществ**.', shortText: 'Оказание услуг в состоянии алкогольного, наркотического опьянения, а также употребление/хранение алкогольных напитков, наркотических средств, психотропных веществ' },
  { id: '7', fullText: '7. **Нарушение правил в месте оказания услуг** (п. 2.6 Договора).', shortText: 'Нарушение правил в месте оказания услуг' },
  { id: '8', fullText: '8. **Нарушение техники безопасности, охраны труда** (в том числе отсутствие хотя бы 1 элемента СИЗ), **пожарной безопасности и экологической безопасности, внутриобъектного режима** в месте оказания услуг.', shortText: 'Нарушение техники безопасности, охраны труда, пожарной безопасности и экологической безопасности, внутриобъектного режима' },
  { id: '9', fullText: '9. **Причинение вреда имуществу Заказчика или имуществу третьих лиц** (в т.ч., повреждение товара, потеря товарного вида, нарушение заводской и транспортной упаковки), если стоимость ТМЦ до 2 500 рублей.', shortText: 'Причинение вреда имуществу Заказчика или имуществу третьих лиц, если стоимость ТМЦ до 2 500 рублей' },
  { id: '10', fullText: '10. **Употребление в пищу ТМЦ**.', shortText: 'Употребление в пищу ТМЦ' },
  { id: '11', fullText: '11. **Причинение вреда имуществу Заказчика или имуществу третьих лиц** (в т.ч. повреждение товара, потеря товарного вида, нарушение заводской и транспортной упаковки), если стоимость ТМЦ свыше 2 500 рублей.', shortText: 'Причинение вреда имуществу Заказчика или имуществу третьих лиц, если стоимость ТМЦ свыше 2 500 рублей' },
  { id: '12', fullText: '12. **Нарушение заявки** (опоздание, не соблюдение графика пауз и т.п.) без уважительных причин.', shortText: 'Нарушение заявки' },
  { id: '13', fullText: '13. **Несоблюдение требований, предписанных дорожными знаками или разметки проезжей части** на территории складского комплекса, курьерской станции.', shortText: 'Несоблюдение требований, предписанных дорожными знаками или разметки проезжей части' },
  { id: '14', fullText: '14. **Препятствие в работе СБ, ЧОП, персонала складского комплекса** (курьерской станции) (отказ от дачи объяснений).', shortText: 'Препятствие в работе СБ, ЧОП, персонала складского комплекса' },
  { id: '15', fullText: '15. **Некорректное поведение** (драки, неадекватное поведение, срыв производственных процессов, митинги).', shortText: 'Некорректное поведение' },
  { id: '16', fullText: '16. **Несанкционированный вынос** (в том числе предотвращенная попытка выноса) ТМЦ за пределы объекта или с территории операционной зоны вне зависимости от стоимости ТМЦ.', shortText: 'Несанкционированный вынос ТМЦ за пределы объекта или с территории операционной зоны' },
  { id: '17', fullText: '17. **Выход из операционной зоны минуя пост досмотра**.', shortText: 'Выход из операционной зоны минуя пост досмотра' },
];

interface ShiftSupervisor {
  id: string;
  name: string;
}

const SHIFT_SUPERVISORS: ShiftSupervisor[] = [
  { id: 'zaicev', name: 'Зайцев А.И.' },
  { id: 'ibragimov', name: 'Ибрагимов Р.Р.' },
];

export default function ServiceNoteEditor() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>('');
  const [eo, setEo] = useState('');
  const [productArticle, setProductArticle] = useState('');
  const [productName, setProductName] = useState('');
  const [productQuantity, setProductQuantity] = useState('');
  const [searchingProduct, setSearchingProduct] = useState(false);
  const productArticleRef = useRef<string>('');
  const isAutoFillingRef = useRef<boolean>(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    loadEmployees();
    loadCompanies();
  }, []);

  // Автопоиск товара при вводе артикула SAP или штрихкода
  useEffect(() => {
    // Пропускаем, если изменение было программным (автозаполнение)
    if (isAutoFillingRef.current) {
      isAutoFillingRef.current = false;
      return;
    }

    // Пропускаем, если значение не изменилось
    if (productArticleRef.current === productArticle) {
      return;
    }

    productArticleRef.current = productArticle;

    const searchProduct = async () => {
      if (!productArticle.trim()) {
        setProductName('');
        return;
      }

      // Ждем 500ms после последнего ввода (debounce)
      const timeoutId = setTimeout(async () => {
        setSearchingProduct(true);
        try {
          const response = await axios.get(`/api/products/search?code=${encodeURIComponent(productArticle.trim())}`);
          if (response.data.found) {
            // Если найден по штрихкоду - заполняем артикул SAP (GROUP_CODE) и название товара
            if (response.data.searchType === 'barcode') {
              if (response.data.groupCode && response.data.groupCode !== productArticle) {
                isAutoFillingRef.current = true;
                setProductArticle(response.data.groupCode);
              }
              if (response.data.productName) {
                setProductName(response.data.productName);
              }
            } 
            // Если найден по GROUP_CODE - заполняем только название товара
            else if (response.data.searchType === 'group_code') {
              if (response.data.productName) {
                setProductName(response.data.productName);
              }
            }
          } else {
            // Если товар не найден, не очищаем поля, чтобы пользователь мог ввести вручную
          }
        } catch (error) {
          console.error('Error searching product:', error);
          // При ошибке не очищаем поля
        } finally {
          setSearchingProduct(false);
        }
      }, 500);

      return () => clearTimeout(timeoutId);
    };

    searchProduct();
  }, [productArticle]);

  useEffect(() => {
    // Фильтруем сотрудников по выбранной компании
    if (selectedCompany) {
      setFilteredEmployees(employees.filter(emp => emp.company === selectedCompany));
      // Автоматически выбираем первого сотрудника из компании, если он один
      const companyEmployees = employees.filter(emp => emp.company === selectedCompany);
      if (companyEmployees.length === 1) {
        setSelectedEmployee(companyEmployees[0]);
      } else {
        setSelectedEmployee(null);
      }
    } else {
      setFilteredEmployees(employees);
    }
  }, [selectedCompany, employees]);

  const loadEmployees = async () => {
    try {
      const response = await axios.get('/api/employees-mapping');
      setEmployees(response.data.rows || []);
      setFilteredEmployees(response.data.rows || []);
    } catch (error) {
      console.error('Error loading employees:', error);
      setError('Не удалось загрузить список сотрудников');
    }
  };

  const loadCompanies = async () => {
    try {
      const response = await axios.get('/api/companies');
      setCompanies(response.data || []);
    } catch (error) {
      console.error('Error loading companies:', error);
    }
  };

  const handleGenerate = async () => {
    if (!selectedEmployee || !selectedCompany || !selectedReason || !selectedSupervisor) {
      setError('Заполните все обязательные поля: Сотрудник, Компания, Причина, Начальник смены');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const selectedReasonObj = REASONS.find(r => r.id === selectedReason);
      if (!selectedReasonObj) {
        setError('Выбрана неверная причина');
        setLoading(false);
        return;
      }

      // Генерируем документ на сервере
      const selectedSupervisorObj = SHIFT_SUPERVISORS.find(s => s.id === selectedSupervisor);
      // Стартуем запрос, но не ждём его до печати — печать должна быть инициирована кликом пользователя.
      const requestPromise = axios.post(
        '/api/service-note/generate',
        {
          date,
          employee: selectedEmployee.name,
          employeeCode: selectedEmployee.code,
          company: selectedCompany,
          reason: selectedReasonObj.shortText,
          reasonNumber: selectedReasonObj.id,
          supervisor: selectedSupervisorObj?.name || '',
          eo: eo.trim() || '',
          productArticle: productArticle.trim() || '',
          productName: productName.trim() || '',
          productQuantity: productQuantity.trim() || ''
        },
        { responseType: 'blob' }
      );

      // Печать сразу по клику (печатаем HTML-предпросмотр).
      // Если делать печать после await — браузер часто открывает пустой диалог/блокирует печать.
      handlePrintFromGenerate();

      const response = await requestPromise;

      // Создаем ссылку для скачивания
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Служебная_записка_${selectedEmployee.name}_${date}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      setError(error.response?.data?.error || 'Ошибка при генерации документа');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setSelectedEmployee(null);
    setSelectedCompany('');
    setSelectedReason('');
    setSelectedSupervisor('');
    setEo('');
    setProductArticle('');
    setProductName('');
    setProductQuantity('');
    setError(null);
    setSuccess(false);
    setShowPreview(false);
  };

  const handlePreview = () => {
    if (!selectedEmployee || !selectedCompany || !selectedReason || !selectedSupervisor) {
      setError('Заполните все обязательные поля для предпросмотра');
      return;
    }
    setShowPreview(true);
  };

  const handlePrintFromGenerate = () => {
    // Печать для кнопки "СГЕНЕРИРОВАТЬ ДОКУМЕНТ" должна работать как и в предпросмотре.
    // Печатаем из заранее загруженного iframe с srcDoc=generatePreviewHTML().
    try {
      const iframe = printIframeRef.current;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow;

      const hasContent =
        !!doc &&
        doc.readyState === 'complete' &&
        !!doc.body &&
        doc.body.innerHTML.trim().length > 0;

      if (win && hasContent) {
        win.focus();
        win.print();
        return;
      }
    } catch {
      // ignore and fallback below
    }

    // Фолбэк: печатаем через новое окно (в рамках клика пользователя)
    const html = generatePreviewHTML();
    if (!html) return;

    try {
      const w = window.open('', '_blank', 'noopener,noreferrer');
      if (!w) return;
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
      w.close();
    } catch {
      // Последний фолбэк: старый способ через временный iframe (может быть заблокирован браузером)
      printHTML(html);
    }
  };

  const printHTML = (html: string) => {
    // Печать "без сохранения файла" через временный iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';

    const cleanup = () => {
      // Дадим браузеру открыть диалог печати, потом уберём iframe
      setTimeout(() => {
        try {
          iframe.remove();
        } catch {
          // ignore
        }
      }, 1000);
    };

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        cleanup();
      }
    };

    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  };

  const handlePrintFromPreview = () => {
    // Печать из уже открытого предпросмотра
    try {
      previewIframeRef.current?.contentWindow?.focus();
      previewIframeRef.current?.contentWindow?.print();
    } catch {
      // Фолбэк: печатаем текущий HTML через временный iframe
      const html = generatePreviewHTML();
      if (html) {
        printHTML(html);
      }
    }
  };

  const generatePreviewHTML = () => {
    if (!selectedEmployee || !selectedCompany || !selectedReason || !selectedSupervisor) {
      return '';
    }

    const selectedReasonObj = REASONS.find(r => r.id === selectedReason);
    if (!selectedReasonObj) {
      return '';
    }

    const selectedSupervisorObj = SHIFT_SUPERVISORS.find(s => s.id === selectedSupervisor);
    if (!selectedSupervisorObj) {
      return '';
    }

    const dateObj = new Date(date);
    const formattedDate = dateObj.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    return `
<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
    <meta charset="UTF-8">
    <meta name="ProgId" content="Word.Document">
    <meta name="Generator" content="Microsoft Word">
    <meta name="Originator" content="Microsoft Word">
    <title>Служебная записка</title>
    <style>
        @page {
            size: A4;
            margin: 2.5cm 2cm 2cm 2cm;
        }
        body {
            font-family: 'Times New Roman', serif;
            font-size: 14pt;
            line-height: 1.5;
            margin: 0;
            padding: 20px;
        }
        .header-top {
            text-align: right;
            margin-bottom: 30px;
        }
        .header-top p {
            margin: 5px 0;
        }
        .title {
            text-align: center;
            font-weight: bold;
            font-size: 16pt;
            margin: 30px 0;
            text-transform: uppercase;
        }
        .title-subtitle {
            text-align: center;
            font-weight: normal;
            font-size: 14pt;
            margin-top: 10px;
        }
        .content {
            text-align: justify;
            margin: 20px 0;
            text-indent: 1.25cm;
            font-size: 11pt;
        }
        .signature {
            margin-top: 50px;
            font-size: 11pt;
        }
        .shift-signature {
            display: flex;
            align-items: baseline;
            gap: 18px;
            margin: 0;
        }
        .shift-signature .label {
            white-space: nowrap;
        }
        .shift-signature .line {
            white-space: nowrap;
        }
        .shift-signature .name {
            white-space: nowrap;
        }
        .spacer {
            height: 55px;
        }
        .brig-lines {
            text-align: center;
            margin: 0;
        }
        .brig-labels {
            text-align: left;
            margin: 0;
        }
        .brig-right {
            text-align: right;
            margin: 0;
        }
        .field {
            font-weight: bold;
        }
        p {
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="header-top">
        <p>Директору</p>
        <p>склада FMCG-СПб</p>
        <p>Геращенко И.С.</p>
        <p>От начальника смены</p>
        <p><span class="field">${selectedSupervisorObj.name}</span></p>
    </div>
    
    <div class="title">
        СЛУЖЕБНАЯ ЗАПИСКА
    </div>
    <div class="title-subtitle">
        <strong>О выявленных нарушениях в процессе работы</strong>
    </div>
    
    
    <div class="content">
        <p>
            Настоящим сообщаю, что сегодня, <span class="field">${formattedDate}</span>, со стороны сотрудников <span class="field">${selectedCompany}</span> были выявлены следующие нарушения:
        </p>
        <p>
            - За сотрудником <span class="field">${selectedEmployee.name}</span> было выявлено нарушение по п.<span class="field">${selectedReasonObj.id}</span> приложения №5 к договору № РД-ТФД55-44 от 01.01.2024, а именно <span class="field">${selectedReasonObj.shortText}</span>${productName.trim() || productArticle.trim() || productQuantity.trim() ? ', товара ' : ''}${productName.trim() ? `«<span class="field">${productName.trim()}</span>»` : ''}${productArticle.trim() ? `, (артикул <span class="field">${productArticle.trim()}</span>)` : ''}${productQuantity.trim() ? ` в количестве <span class="field">${productQuantity.trim()}</span> шт` : ''}${eo.trim() ? `, (ео. <span class="field">${eo.trim()}</span>)` : ''}.
        </p>
    </div>
    
    <div class="signature">
        <p class="shift-signature">
            <span class="label">Начальник смены</span>
            <span class="line">_________________</span>
            <span class="name">${selectedSupervisorObj.name}</span>
        </p>

        <div class="spacer"></div>

        <p class="brig-lines">_____________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;____________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;_____________________________</p>
        <p class="brig-labels">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(ДАТА)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(подпись)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(ФИО)</p>

        <div class="spacer" style="height: 22px;"></div>

        <p class="brig-right">Со служебной запиской ознакомлен</p>
        <p class="brig-right">Нарушения подтверждаю</p>
        <p class="brig-right">Бригадир ООО ${selectedCompany}</p>
    </div>
</body>
</html>
    `;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-6">Составление Служебных Записок</h2>

      {success && (
        <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
          Служебная записка успешно сгенерирована!
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Дата */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Дата: <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Компания */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Компания: <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" key="company-empty">Выберите компанию</option>
            {companies.map((company, index) => (
              <option key={`company-${company.id}-${index}`} value={company.name}>
                {company.name}
              </option>
            ))}
          </select>
        </div>

        {/* Сотрудник */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Сотрудник: <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedEmployee?.code || ''}
            onChange={(e) => {
              const employee = filteredEmployees.find(emp => emp.code === e.target.value);
              setSelectedEmployee(employee || null);
            }}
            disabled={!selectedCompany || filteredEmployees.length === 0}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="" key="employee-empty">
              {!selectedCompany 
                ? 'Сначала выберите компанию' 
                : filteredEmployees.length === 0 
                  ? 'Нет сотрудников в этой компании' 
                  : 'Выберите сотрудника'}
            </option>
            {filteredEmployees.map((employee, index) => (
              <option key={`employee-${employee.code}-${employee.company}-${index}`} value={employee.code}>
                {employee.name} ({employee.code})
              </option>
            ))}
          </select>
        </div>

        {/* Начальник смены */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Начальник смены: <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedSupervisor}
            onChange={(e) => setSelectedSupervisor(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" key="supervisor-empty">Выберите начальника смены</option>
            {SHIFT_SUPERVISORS.map((supervisor, index) => (
              <option key={`supervisor-${supervisor.id}-${index}`} value={supervisor.id}>
                {supervisor.name}
              </option>
            ))}
          </select>
        </div>

        {/* Причина */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Причина: <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" key="reason-empty">Выберите причину</option>
            {REASONS.map((reason, index) => (
              <option key={`reason-${reason.id}-${index}`} value={reason.id}>
                {reason.fullText}
              </option>
            ))}
          </select>
        </div>

        {/* ЕО */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            ЕО:
          </label>
          <input
            type="text"
            value={eo}
            onChange={(e) => setEo(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Введите ЕО (если требуется)"
          />
        </div>

        {/* Артикул SAP или Штрихкод */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Артикул SAP / Штрихкод:
          </label>
          <div className="relative">
            <input
              type="text"
              value={productArticle}
              onChange={(e) => {
                isAutoFillingRef.current = false;
                setProductArticle(e.target.value);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Введите артикул SAP или штрихкод (если требуется)"
            />
            {searchingProduct && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm">
                Поиск...
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Можно ввести артикул SAP или штрихкод товара
          </p>
        </div>

        {/* Название товара */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Название товара:
          </label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={productArticle.trim() ? "Автозаполнение по артикулу SAP..." : "Введите название товара (если требуется)"}
            disabled={searchingProduct}
          />
          {productArticle.trim() && productName && (
            <p className="text-xs text-green-600 mt-1">
              ✓ Найдено по артикулу SAP
            </p>
          )}
        </div>

        {/* Количество товара */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Количество товара (шт):
          </label>
          <input
            type="text"
            value={productQuantity}
            onChange={(e) => setProductQuantity(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Введите количество (если требуется)"
          />
        </div>

        {/* Кнопки */}
        <div className="flex gap-4 pt-4">
          <button
            onClick={handlePreview}
            disabled={!selectedEmployee || !selectedCompany || !selectedReason}
            className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            ПРЕДПРОСМОТР
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || !selectedEmployee || !selectedCompany || !selectedReason}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Генерация...' : 'СГЕНЕРИРОВАТЬ ДОКУМЕНТ'}
          </button>
          <button
            onClick={handleClear}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            ОЧИСТИТЬ
          </button>
        </div>
      </div>

      {/* Модальное окно предпросмотра */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-xl font-bold">Предпросмотр служебной записки</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-gray-50">
              <iframe
                ref={previewIframeRef}
                srcDoc={generatePreviewHTML()}
                className="w-full h-full min-h-[600px] border border-gray-300 bg-white"
                title="Предпросмотр служебной записки"
              />
            </div>
            <div className="flex justify-end gap-4 p-4 border-t border-gray-200">
              <button
                onClick={handlePrintFromPreview}
                disabled={loading || !selectedEmployee || !selectedCompany || !selectedReason || !selectedSupervisor}
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Печать
              </button>
              <button
                onClick={() => setShowPreview(false)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
              >
                Закрыть
              </button>
              <button
                onClick={() => {
                  setShowPreview(false);
                  handleGenerate();
                }}
                disabled={loading || !selectedEmployee || !selectedCompany || !selectedReason || !selectedSupervisor}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? 'Генерация...' : 'Скачать документ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Скрытый iframe для печати по клику "СГЕНЕРИРОВАТЬ ДОКУМЕНТ" (без предпросмотра) */}
      <iframe
        ref={printIframeRef}
        srcDoc={generatePreviewHTML()}
        title="Печать служебной записки"
        style={{
          position: 'fixed',
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          border: 0,
          opacity: 0,
          pointerEvents: 'none'
        }}
      />
    </div>
  );
}

