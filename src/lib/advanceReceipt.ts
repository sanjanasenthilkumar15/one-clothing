import { jsPDF } from 'jspdf'
import { BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { LOGO_BASE64 } from './logoBase64'
import { formatCurrency } from './retail'
import { formatPaymentLabel, normalizePaymentMode, round2, splitGst } from './payments'
import { getAdvancePricing, type AdvanceOrder, type AdvancePayment } from '../services/advanceOrderService'
import { formatPhoneDisplay } from './phone'
import { printHtmlDocument } from './printHtml'

const esc = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))

// jsPDF's built-in Helvetica font does not include the ₹ Unicode glyph (U+20B9).
// Using the Intl formatter directly causes the ₹ character to render as "1" or a
// replacement box in PDF viewers. This PDF-safe formatter outputs "Rs." instead.
const pdfMoney = (value: number): string => {
  const formatted = formatCurrency(value)
  // Replace leading ₹ (with optional non-breaking space) with "Rs. "
  return formatted.replace(/^[₹\u20b9]\s*/, 'Rs. ')
}

export type AdvanceFinancials = {
  subtotal: number; delivery: number; discount: number; cgst: number; sgst: number
  couponCode: string | null; couponDiscount: number; manualDiscount: number
  total: number; deposit: number; balancePaid: number; remaining: number; settled: boolean; completed: boolean
}

/** Single source for the financial breakdown shown in the drawer, receipt and PDF. */
export function advanceFinancials(order: AdvanceOrder): AdvanceFinancials {
  const completed = order.status === 'completed' || Boolean(order.invoice_number)
  const pricing = getAdvancePricing(order)
  const couponDiscount = round2(pricing ? pricing.coupon_discount : 0)
  const manualDiscount = round2(pricing ? pricing.manual_discount : completed ? order.breakdown?.discount || 0 : 0)
  const discount = round2(couponDiscount + manualDiscount)
  const subtotal = pricing ? pricing.subtotal : order.total_amount
  const delivery = round2(pricing ? pricing.delivery : completed ? order.breakdown?.delivery || 0 : 0)
  const gst = round2(pricing ? pricing.gst : completed ? order.breakdown?.gst || 0 : 0)
  const { cgst, sgst } = splitGst(gst)
  // With captured POS pricing the stored order amount is already the net payable total
  const total = pricing ? order.total_amount : completed ? Math.max(0, round2(subtotal - discount + delivery + gst)) : subtotal
  const balancePaid = completed ? Math.max(0, round2(total - order.deposit_amount)) : 0
  const remaining = completed ? 0 : Math.max(0, order.remaining_balance)
  return { subtotal, delivery, discount, cgst, sgst, couponCode: pricing?.coupon_code || null, couponDiscount, manualDiscount, total, deposit: order.deposit_amount, balancePaid, remaining, settled: remaining < 0.005, completed }
}

const paymentLine = (payment: AdvancePayment) => {
  const kind = payment.payment_type === 'deposit' ? 'Deposit' : 'Final balance'
  const label = formatPaymentLabel(payment.payment_method, payment.split_details) || String(payment.payment_method || '').toUpperCase()
  // Split labels already carry the per-channel amounts
  return normalizePaymentMode(payment.payment_method) === 'split' ? `${kind}: ${label}` : `${kind}: ${label} ${formatCurrency(Number(payment.amount))}`
}

/** One line per payment received (deposit, then final balance), including split breakdowns. */
export function advancePaymentLines(order: AdvanceOrder): string[] {
  if (order.payments && order.payments.length) return order.payments.map(paymentLine)
  if (!order.final_payment_method) return ['Cash']
  if (order.final_payment_method === 'upi') return ['UPI / QR']
  if (order.final_payment_method === 'split') return [formatPaymentLabel('split', order.split_details)]
  return [order.final_payment_method.toUpperCase()]
}

export function advancePaymentText(order: AdvanceOrder): string {
  return advancePaymentLines(order).join(' | ')
}

export function advanceReceiptPdf(order: AdvanceOrder) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFillColor('#111111'); doc.rect(0, 0, 210, 5, 'F')
  try { doc.addImage(LOGO_BASE64, 'PNG', 16, 9, 16, 16) } catch (_err) { /* ignore missing logo */ }
  doc.setTextColor('#6B7280'); doc.setFontSize(8); doc.text('ADVANCE RECEIPT - NOT A TAX INVOICE', 38, 26)

  doc.setFont('helvetica', 'normal'); doc.text(BRAND_ADDRESS, 194, 20, { align: 'right', maxWidth: 76 }); doc.text(BRAND_PRIMARY_PHONE_DISPLAY, 194, 30, { align: 'right' })
  doc.setDrawColor('#C9B79C'); doc.line(16, 38, 194, 38)
  doc.setTextColor('#1F1F1F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(order.deposit_id, 16, 51)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor('#6B7280'); doc.text(`Created: ${new Date(order.created_at).toLocaleString('en-IN')}`, 194, 51, { align: 'right' })
  const rows = [
    ['Customer', order.customer_name], ['Phone', formatPhoneDisplay(order.phone)], ['Address', order.address || '-'], ['Product', order.product_name],
    ['Category', order.category || '-'], ['Expected delivery', new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN')],
  ]
  let y = 66
  rows.forEach(([label, value]) => { doc.setFont('helvetica', 'bold'); doc.setTextColor('#6B7280'); doc.text(label.toUpperCase(), 16, y); doc.setFont('helvetica', 'normal'); doc.setTextColor('#1F1F1F'); doc.text(String(value), 64, y, { maxWidth: 126 }); y += 10 })
  const fin = advanceFinancials(order)
  const money: Array<readonly [string, number, boolean]> = [
    ['Subtotal', fin.subtotal, false],
    ...(fin.couponDiscount > 0 ? [[fin.couponCode ? `Coupon (${fin.couponCode})` : 'Coupon', -fin.couponDiscount, false] as const] : []),
    ...(fin.manualDiscount > 0 ? [['Manual discount', -fin.manualDiscount, false] as const] : []),
    ...(fin.cgst + fin.sgst > 0 ? [['CGST', fin.cgst, false] as const, ['SGST', fin.sgst, false] as const] : []),
    ['Delivery charges', fin.delivery, false],
    ['Total order amount', fin.total, true],
    ['Deposit paid', fin.deposit, false], ...(fin.completed ? [['Final balance paid', fin.balancePaid, false] as const] : []),
    ['Remaining balance', fin.remaining, true],
  ]
  y += 4; const boxH = 10 + money.length * 8
  doc.setFillColor('#FBFAF6'); doc.roundedRect(16, y, 178, boxH, 3, 3, 'F')
  money.forEach(([label, value, strong], index) => {
    const rowY = y + 9 + index * 8
    doc.setFont('helvetica', strong ? 'bold' : 'normal'); doc.setTextColor(strong ? '#7A6A4F' : '#374151')
    doc.text(label, 22, rowY)
    doc.text(label === 'Delivery charges' && value === 0 ? 'Free' : value < 0 ? `-${pdfMoney(-value)}` : pdfMoney(value), 188, rowY, { align: 'right' })
  })
  // Payment lines (deposit + final, with split breakdown); Helvetica has no rupee glyph
  const paymentLines = advancePaymentLines(order).flatMap(line => doc.splitTextToSize(`Payment - ${line}`.replace(/₹\s*/g, 'Rs. '), 178) as string[])
  doc.setFont('helvetica', 'normal'); doc.setTextColor('#374151'); doc.setFontSize(9)
  paymentLines.forEach((line, index) => doc.text(line, 16, y + boxH + 8 + index * 5))
  const footY = y + boxH + 8 + paymentLines.length * 5 + 7
  doc.setFont('helvetica', 'bold'); doc.setTextColor('#b45309'); doc.setFontSize(9)
  doc.text(fin.completed ? `Fully settled - Invoice ${order.invoice_number || ''}` : 'This receipt records an advance payment only. It is not a final invoice.', 105, footY, { align: 'center' })
  return new File([doc.output('blob')], `Advance-Receipt-${order.deposit_id}.pdf`, { type: 'application/pdf' })
}

export function printAdvanceReceipt(order: AdvanceOrder) {
  try {
    const paymentRows = advancePaymentLines(order).map(line => `<div class="r"><span class="label">Payment</span><span>${esc(line)}</span></div>`).join('')
    const fin = advanceFinancials(order)

    const html = `<!doctype html><html lang="en" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" spellcheck="false"><head><title>Advance Receipt ${esc(order.deposit_id)}</title>
<meta charset="utf-8">
<meta name="grammarly" content="off">
<meta name="robots" content="noindex,nofollow">
<style>
  @page { size: 80mm auto; margin: 0; }
  @media print { @page { size: 80mm auto; margin: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 12px;
    width: 72mm;
    padding: 4mm;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .c { text-align: center; }
  .r { display: flex; justify-content: space-between; gap: 4px; margin: 5px 0; word-break: break-word; }
  .r span:first-child { flex-shrink: 0; max-width: 55%; }
  .r span:last-child { text-align: right; flex: 1; }
  .line { border-top: 1px dashed #555; margin: 8px 0; }
  .big { font-size: 15px; font-weight: bold; }
  .bold { font-weight: bold; }
  .warn { font-size: 9px; font-weight: bold; margin-top: 10px; text-align: center; }
  .label { font-size: 10px; color: #555; }
  .balance-row { font-size: 14px; font-weight: bold; }
</style>
</head><body>
<div class="c" style="margin-bottom: 6px;">
  <div style="font-size: 16px; font-weight: 900;">${esc(BRAND_EN)}</div>
</div>
<div class="c" style="font-size:10px;color:#555;">${esc(BRAND_ADDRESS)}</div>
<div class="c" style="font-size:10px;color:#555;">${esc(BRAND_PHONE_DISPLAY)}</div>
<div class="line"></div>
<div class="c big">ADVANCE RECEIPT</div>
<div class="c" style="font-size:10px;">Not a final tax invoice</div>
<div class="line"></div>
<div><span class="bold">${esc(order.deposit_id)}</span></div>
<div style="font-size:10px;color:#555;">${new Date(order.created_at).toLocaleString('en-IN')}</div>
<div class="line"></div>
<div class="r"><span class="label">Customer</span><span class="bold">${esc(order.customer_name)}</span></div>
<div class="r"><span class="label">Phone</span><span>${esc(formatPhoneDisplay(order.phone))}</span></div>
${order.address ? `<div class="r"><span class="label">Address</span><span>${esc(order.address)}</span></div>` : ''}
<div class="r"><span class="label">Product</span><span>${esc(order.product_name)}</span></div>
${order.category ? `<div class="r"><span class="label">Category</span><span>${esc(order.category)}</span></div>` : ''}
<div class="r"><span class="label">Delivery</span><span>${esc(new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN'))}</span></div>
${paymentRows}
<div class="line"></div>
<div class="r"><span>Subtotal</span><span>${esc(formatCurrency(fin.subtotal))}</span></div>
${fin.couponDiscount > 0 ? `<div class="r"><span>${esc(fin.couponCode ? `Coupon (${fin.couponCode})` : 'Coupon')}</span><span>-${esc(formatCurrency(fin.couponDiscount))}</span></div>` : ''}
${fin.manualDiscount > 0 ? `<div class="r"><span>Manual Disc.</span><span>-${esc(formatCurrency(fin.manualDiscount))}</span></div>` : ''}
${fin.cgst + fin.sgst > 0 ? `<div class="r"><span>CGST</span><span>${esc(formatCurrency(fin.cgst))}</span></div>
<div class="r"><span>SGST</span><span>${esc(formatCurrency(fin.sgst))}</span></div>` : ''}
<div class="r"><span>Delivery</span><span>${fin.delivery > 0 ? esc(formatCurrency(fin.delivery)) : 'Free'}</span></div>
<div class="r"><span class="bold">Total Amount</span><span class="bold">${esc(formatCurrency(fin.total))}</span></div>
<div class="r"><span>Deposit Paid</span><span class="bold">${esc(formatCurrency(fin.deposit))}</span></div>
${fin.completed ? `<div class="r"><span>Balance Paid</span><span class="bold">${esc(formatCurrency(fin.balancePaid))}</span></div>` : ''}
<div class="r balance-row"><span>${fin.completed ? 'Remaining Balance' : 'Balance Due'}</span><span>${esc(formatCurrency(fin.remaining))}</span></div>
<div class="line"></div>
<div class="warn">ADVANCE PAYMENT ONLY &mdash; NOT A FINAL INVOICE</div>
</body></html>`

    printHtmlDocument(html)
  } catch (err) {
    console.warn('[advanceReceipt] Failed to print advance receipt:', err)
  }
}

export function downloadFile(file: File) { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500) }

