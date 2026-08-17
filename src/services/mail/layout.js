function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderEmailLayout({ intro, recipientName, rows, workflowUrl }) {
  const safeRows = rows.map(({ label, section, value }) => section ? `
    <tr>
      <td colspan="2" style="padding:10px 12px;border-top:1px solid #cbd5e1;border-bottom:1px solid #e2e8f0;background:#eaf7f5;color:#0f766e;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(section)}</td>
    </tr>
  ` : `
    <tr>
      <td style="width:170px;padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:700;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:600;vertical-align:top;word-break:break-word">${escapeHtml(value)}</td>
    </tr>
  `).join('')

  return `
    <div style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,sans-serif;color:#172033">
      <div style="max-width:720px;margin:0 auto;overflow:hidden;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff">
        <div style="background:#0f766e;padding:20px 24px;color:#ffffff">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85">P.PIYA Solution · OEM Workflow</div>
          <div style="margin-top:6px;font-size:20px;font-weight:800">${escapeHtml(intro)}</div>
        </div>
        <div style="padding:22px 24px">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6">เรียน ทีม ${escapeHtml(recipientName)}</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;background:#f8fafc;font-size:14px">${safeRows}</table>
          <div style="margin-top:20px"><a href="${escapeHtml(workflowUrl)}" style="display:inline-block;border-radius:10px;background:#f59e0b;padding:11px 18px;color:#ffffff;font-size:14px;font-weight:800;text-decoration:none">เปิดระบบ OEM Workflow</a></div>
          <p style="margin:22px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">อีเมลนี้ส่งโดยอัตโนมัติจาก OEM Workflow System กรุณาไม่ตอบกลับอีเมลนี้</p>
        </div>
      </div>
    </div>
  `
}

module.exports = { renderEmailLayout }
