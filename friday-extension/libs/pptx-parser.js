(async function () {
  if (window.pptxToText) return;

  // Load JSZip if not already loaded
  async function loadJSZip() {
    if (window.JSZip) return window.JSZip;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('libs/jszip.min.js');
      script.onload = () => resolve(window.JSZip);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  window.pptxToText = async function (arrayBuffer) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(arrayBuffer);
    let allText = "";

    const slidePaths = Object.keys(zip.files).filter(name =>
      name.match(/^ppt\/slides\/slide\d+\.xml$/)
    );

    slidePaths.sort(); // Ensure slides are in order

    for (const path of slidePaths) {
      const xmlText = await zip.files[path].async("string");
      const matches = [...xmlText.matchAll(/<a:t>(.*?)<\/a:t>/g)];
      const slideText = matches.map(m => m[1]).join(" ");
      allText += slideText + "\n\n";
    }

    return allText.trim();
  };
})();
