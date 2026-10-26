// Kết nối máy chủ ChildTube trên Cloudflare (Worker childtube-api, tài khoản ngochoi.assistant@gmail.com) — từ 2026-10-26.
window.CT_CONFIG = {
  url: 'https://childtube-api.ngochoi-assistant.workers.dev',
  key: '',
  backend: 'cloudflare'
};
// Quay lại Supabase cũ (dữ liệu vẫn còn ở tổ chức "ChildTube Family"): xoá khối trên, bỏ chú thích khối dưới.
// window.CT_CONFIG = {
//   url: 'https://hbzrupxqtolaffndfxtf.supabase.co',
//   key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhienJ1cHhxdG9sYWZmbmRmeHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNjc0MzQsImV4cCI6MjEwNzg0MzQzNH0.YmwCDg2kzSST4dxK6CX8qIitvplmaGWOvz3LPfG7QxM'
// };
