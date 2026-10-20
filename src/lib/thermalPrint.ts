import { BRAND_ADDRESS, BRAND_EMAIL, BRAND_EN, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { formatCurrency, formatItemDisplayName, formatInvoiceNo } from './retail'
import { printHtmlDocument } from './printHtml'
import { formatGstRate, splitGst, splitGstRates } from './payments'

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char] || char))

export interface ThermalReceiptData {
  invoiceNo: string
  date: string
  customerName?: string
  phone?: string
  items: Array<{
    name: string
    qty: number
    unit?: string
    price: number
    line_total?: number
    note?: string | null
    variant_name?: string | null
  }>
  subtotal: number
  shipping: number
  couponDiscount?: number
  manualDiscount?: number
  totalGst?: number
  total: number
  paymentMode?: string
  paymentLines?: string[]
  /** Advance-order settlement lines shown under the total */
  advance?: { depositPaid: number; balancePaid: number; remaining: number }
  couponCode?: string | null
  storeName?: string
  storePhone?: string
  storeAddress?: string
  storeEmail?: string
}

export function printThermalReceipt(data: ThermalReceiptData) {
  try {
    const dateStr = (() => {
      try { return new Date(data.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
      catch { return new Date().toLocaleString('en-IN') }
    })()

    const formatCustomerPhone = (phone?: string): string => {
      if (!phone) return ''
      const trimmed = phone.trim()
      const digits = trimmed.replace(/\D/g, '')
      if (digits.length === 12 && digits.startsWith('91')) {
        return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
      }
      if (digits.length === 10) {
        return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
      }
      return trimmed
    }

    const gstParts = splitGst(data.totalGst || 0)
    const gstRates = splitGstRates(data.totalGst || 0, data.subtotal - (data.couponDiscount || 0) - (data.manualDiscount || 0))
    const html = `
      <!DOCTYPE html>
      <html lang="en" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" spellcheck="false">
        <head>
          <meta charset="UTF-8">
          <meta name="grammarly" content="off">
          <meta name="robots" content="noindex,nofollow">
          <title>Receipt - ${data.invoiceNo}</title>
        <style>
          @page {
            margin: 0;
            size: 80mm auto;
          }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 12px;
            color: #000;
            margin: 0;
            padding: 4mm;
            width: 80mm;
            box-sizing: border-box;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .font-bold { font-weight: bold; }
          .mb-1 { margin-bottom: 4px; }
          .mb-2 { margin-bottom: 8px; }
          .mt-1 { margin-top: 4px; }
          .mt-2 { margin-top: 8px; }
          .border-bottom { border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px; }
          .border-top { border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 2px 0; vertical-align: top; }
          .item-name { font-size: 11px; padding-right: 4px; }
        </style>
      </head>
      <body>
        <div class="text-center mb-2">
          <div style="font-size: 16px; font-weight: 900; letter-spacing: 0.3px;">${BRAND_EN}</div>
          <div style="font-size: 9.5px; margin-top: 2px; line-height: 1.3;">${data.storeAddress || BRAND_ADDRESS}</div>
          <div class="mt-1" style="font-size: 10px; font-weight: bold;">Ph: ${BRAND_PRIMARY_PHONE_DISPLAY}</div>
          <div style="font-size: 9px; color: #333;">${data.storeEmail || BRAND_EMAIL}</div>
        </div>

        <div class="border-bottom border-top" style="font-size: 11px;">
          <div>Inv: #${formatInvoiceNo(data.invoiceNo)}</div>
          <div>Date: ${dateStr}</div>
          ${data.paymentLines?.length
            ? data.paymentLines.map(line => `<div>Payment: ${escapeHtml(line)}</div>`).join('')
            : data.paymentMode ? `<div>Payment: ${escapeHtml(data.paymentMode)}</div>` : ''}
          ${data.customerName ? `<div>Name: ${data.customerName}</div>` : ''}
          ${data.phone ? `<div>Tel: ${formatCustomerPhone(data.phone)}</div>` : ''}
        </div>

        <table class="border-bottom" style="width: 100%; table-layout: fixed; border-collapse: collapse;">
          <thead>
            <tr style="font-size: 10px; border-bottom: 1px dashed #000;">
              <th style="width: 50%; text-align: left; padding: 4px 0;">Item Name</th>
              <th style="width: 18%; text-align: center; padding: 4px 0;">Qty</th>
              <th style="width: 32%; text-align: right; padding: 4px 0;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map(item => {
              const lineTotal = item.line_total ?? (item.qty * item.price)
              const unit = item.unit && item.unit !== 'unit' && item.unit !== 'piece' ? item.unit : ''
              const rateDisplay = `${formatCurrency(item.price)}${unit ? `/${unit}` : ''}`
              const displayName = escapeHtml(formatItemDisplayName(item.name, item.variant_name, item.note))
              return `
                <tr>
                  <td style="text-align: left; padding: 3px 2px 3px 0; vertical-align: top; word-break: break-word;">
                    <div style="font-size: 11px; font-weight: bold; line-height: 1.25;">${displayName}</div>
                    <div style="font-size: 9px; color: #444; margin-top: 1px;">${rateDisplay}</div>
                  </td>
                  <td style="text-align: center; vertical-align: top; padding: 3px 0; font-size: 11px;">
                    ${item.qty}
                  </td>
                  <td style="text-align: right; vertical-align: top; padding: 3px 0; font-size: 11px; font-weight: bold;">
                    ${formatCurrency(lineTotal)}
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>

        <div class="border-bottom" style="font-size: 12px;">
          <table style="width: 100%;">
            <tr>
              <td class="text-left">Subtotal</td>
              <td class="text-right">${formatCurrency(data.subtotal)}</td>
            </tr>
            ${(data.couponDiscount || 0) > 0 ? `
              <tr>
                <td class="text-left">Coupon${data.couponCode ? ` (${data.couponCode})` : ''}</td>
                <td class="text-right">-${formatCurrency(data.couponDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.manualDiscount || 0) > 0 ? `
              <tr>
                <td class="text-left">Manual Disc.</td>
                <td class="text-right">-${formatCurrency(data.manualDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.totalGst || 0) > 0 ? `
              <tr>
                <td class="text-left">CGST${gstRates ? ` (${formatGstRate(gstRates.cgst)})` : ''}</td>
                <td class="text-right">+${formatCurrency(gstParts.cgst)}</td>
              </tr>
              <tr>
                <td class="text-left">SGST${gstRates ? ` (${formatGstRate(gstRates.sgst)})` : ''}</td>
                <td class="text-right">+${formatCurrency(gstParts.sgst)}</td>
              </tr>
            ` : ''}
            <tr>
              <td class="text-left">Delivery</td>
              <td class="text-right">${data.shipping > 0 ? formatCurrency(data.shipping) : 'Free'}</td>
            </tr>
            <tr class="font-bold" style="font-size: 14px;">
              <td class="text-left">Total</td>
              <td class="text-right">${formatCurrency(data.total)}</td>
            </tr>
            ${data.advance ? `
              <tr>
                <td class="text-left font-bold">Deposit Paid</td>
                <td class="text-right">${formatCurrency(data.advance.depositPaid)}</td>
              </tr>
              <tr>
                <td class="text-left font-bold">Balance Paid</td>
                <td class="text-right">${formatCurrency(data.advance.balancePaid)}</td>
              </tr>
              <tr class="font-bold">
                <td class="text-left">Remaining Balance</td>
                <td class="text-right">${formatCurrency(data.advance.remaining)}</td>
              </tr>
            ` : ''}
          </table>
        </div>

        <div class="text-center mt-2" style="font-size: 11px;">
          <div class="font-bold">Thank you for shopping at The One Clothing!</div>
        </div>
      </body>
    </html>
  `

    printHtmlDocument(html)
  } catch (err) {
    console.warn('[thermalPrint] Failed to print receipt:', err)
  }
}
