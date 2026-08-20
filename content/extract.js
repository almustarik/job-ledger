(() => {
  function text(el) {
    return el?.textContent?.replace(/\s+/g, " ").trim() || "";
  }

  function guessCompany() {
    const og = document.querySelector('meta[property="og:site_name"]')?.content;
    if (og) return og.trim();

    const linkedIn = document.querySelector(
      ".job-details-jobs-unified-top-card__company-name a, .topcard__org-name-link, a.topcard__org-name-link"
    );
    if (linkedIn) return text(linkedIn);

    const greenhouse = document.querySelector(".company-name, .app-title .company-name");
    if (greenhouse) return text(greenhouse);

    const ashby = document.querySelector('[class*="CompanyName"], .ashby-job-board-heading h1 + div');
    if (ashby) return text(ashby);

    const host = location.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length >= 2) {
      const name = parts[parts.length - 2];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return host;
  }

  function guessTitle() {
    const h1 = document.querySelector("h1");
    if (h1 && text(h1).length < 160) return text(h1);

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (ogTitle) return ogTitle.replace(/\s*[|\-–].*$/, "").trim();

    return (document.title || "").replace(/\s*[|\-–].*$/, "").trim();
  }

  function guessSource() {
    const host = location.hostname;
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("greenhouse.io") || host.includes("boards.greenhouse")) return "company";
    if (host.includes("ashbyhq.com") || host.includes("lever.co") || host.includes("myworkdayjobs.com")) {
      return "company";
    }
    return "company";
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXTRACT_JOB") {
      sendResponse({
        company: guessCompany(),
        title: guessTitle(),
        url: location.href,
        source: guessSource(),
        pageTitle: document.title,
      });
    }
    return true;
  });
})();
