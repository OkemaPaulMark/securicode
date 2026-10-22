// Applies a saved light/dark choice before first paint (kept external so the CSP needs no 'unsafe-inline').
try { var t = localStorage.getItem("securicode.theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) {}
