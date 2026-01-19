import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import fs from 'fs';
import path from 'path';
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';

const router = express.Router();

// Генерация служебной записки
router.post('/generate', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { date, employee, employeeCode, company, reason, reasonNumber, supervisor, eo, productArticle, productName, productQuantity } = req.body;

    if (!date || !employee || !company || !reason || !supervisor) {
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    }

    // Форматируем дату для отображения
    const dateObj = new Date(date);
    const formattedDate = dateObj.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    // Создаем настоящий .docx документ
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          // Шапка справа сверху
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'Директору',
                font: 'Times New Roman',
                size: 28, // 14pt
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'склада FMCG-СПб',
                font: 'Times New Roman',
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'Геращенко И.С.',
                font: 'Times New Roman',
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            children: [new TextRun('')],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'От начальника смены',
                font: 'Times New Roman',
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: supervisor,
                bold: true,
                font: 'Times New Roman',
                size: 28,
              }),
            ],
          }),
          // Пустая строка
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          // Заголовок (центрирование)
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: 'СЛУЖЕБНАЯ ЗАПИСКА',
                bold: true,
                font: 'Times New Roman',
                size: 32, // 16pt
              }),
            ],
          }),
          // Подзаголовок
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: 'О выявленных нарушениях в процессе работы',
                bold: true,
                font: 'Times New Roman',
                size: 28, // 14pt
              }),
            ],
          }),
          // Пустая строка
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          // Вводный текст
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            indent: {
              firstLine: 720, // 1.25cm в twips (1cm = 567 twips)
            },
            children: [
              new TextRun({
                text: 'Настоящим сообщаю, что сегодня, ',
                font: 'Times New Roman',
                size: 22, // 11pt
              }),
              new TextRun({
                text: formattedDate,
                bold: true,
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: ', со стороны сотрудников ',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: company,
                bold: true,
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: ' были выявлены следующие нарушения:',
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
          // Пустая строка
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          // Основной текст
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            indent: {
              firstLine: 720, // 1.25cm в twips (1cm = 567 twips)
            },
            children: [
              new TextRun({
                text: '- За сотрудником ',
                font: 'Times New Roman',
                size: 22, // 11pt
              }),
              new TextRun({
                text: employee,
                bold: true,
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: ' было выявлено нарушение по п.',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: reasonNumber || '',
                bold: true,
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: ' приложения №5 к договору № РД-ТФД55-44 от 01.01.2024, а именно ',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: reason,
                bold: true,
                font: 'Times New Roman',
                size: 22,
              }),
              ...(productName || productArticle || productQuantity ? [
                new TextRun({
                  text: ', товара ',
                  font: 'Times New Roman',
                  size: 22,
                }),
                ...(productName ? [
                  new TextRun({
                    text: '«',
                    font: 'Times New Roman',
                    size: 22,
                  }),
                  new TextRun({
                    text: productName,
                    bold: true,
                    font: 'Times New Roman',
                    size: 22,
                  }),
                  new TextRun({
                    text: '»',
                    font: 'Times New Roman',
                    size: 22,
                  }),
                ] : []),
                ...(productArticle ? [
                  new TextRun({
                    text: ', (артикул ',
                    font: 'Times New Roman',
                    size: 22,
                  }),
                  new TextRun({
                    text: productArticle,
                    bold: true,
                    font: 'Times New Roman',
                    size: 22,
                  }),
                  new TextRun({
                    text: ')',
                    font: 'Times New Roman',
                    size: 22,
                  }),
                ] : []),
                ...(productQuantity ? [
                  new TextRun({
                    text: ' в количестве ',
                    font: 'Times New Roman',
                    size: 22,
                  }),
                  new TextRun({
                    text: productQuantity,
                    bold: true,
                    font: 'Times New Roman',
                    size: 22,
                  }),
                  new TextRun({
                    text: ' шт',
                    font: 'Times New Roman',
                    size: 22,
                  }),
                ] : []),
              ] : []),
              ...(eo ? [
                new TextRun({
                  text: ', (ео. ',
                  font: 'Times New Roman',
                  size: 22,
                }),
                new TextRun({
                  text: eo,
                  bold: true,
                  font: 'Times New Roman',
                  size: 22,
                }),
                new TextRun({
                  text: ')',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ] : []),
              new TextRun({
                text: '.',
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
          // Пустые строки перед подписью
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          // Подпись начальника смены (слева)
          new Paragraph({
            children: [
              new TextRun({
                text: 'Начальник смены',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '\t\t\t', // Несколько табуляций
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '_________________',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '\t\t\t', // Еще табуляции
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: supervisor,
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
          
          // Пустая строка
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            children: [new TextRun({ text: '' })],
          }),
          // Блок бригадира (справа)
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: '_____________________',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '     ',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '____________________',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '          ',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '_____________________________',
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: '                     (ДАТА)',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '     ',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '                            (подпись)',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '          ',
                font: 'Times New Roman',
                size: 22,
              }),
              new TextRun({
                text: '                                     (ФИО)',
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: '' })],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'Со служебной запиской ознакомлен',
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'Нарушения подтверждаю',
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `Бригадир ООО ${company}`,
                font: 'Times New Roman',
                size: 22,
              }),
            ],
          }),
        ],
      }],
    });

    // Генерируем .docx файл
    const buffer = await Packer.toBuffer(doc);

    // Правильно кодируем имя файла для заголовка Content-Disposition
    const safeEmployeeName = employee.replace(/[^\w\s-]/g, '_').substring(0, 50);
    const filename = `Служебная_записка_${safeEmployeeName}_${date}.docx`;
    const encodedFilename = encodeURIComponent(filename);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.send(buffer);
  } catch (error) {
    console.error('Error generating service note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

