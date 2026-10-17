/*
 * ApplyPilot — Content Script (form engine)
 * Injected on demand into each frame the extension can reach. It scans the page for
 * form controls, matches them against the profile with heuristics and fills them in a
 * way that React / Vue / Angular state management picks up.
 */
(() => {
  'use strict';

  const ENGINE_VERSION = '1.3.0';
  const extensionAPI = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

  if (globalThis.__ApplyPilotEngine && globalThis.__ApplyPilotEngine.version === ENGINE_VERSION) {
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Text helpers                                                        */
  /* ------------------------------------------------------------------ */

  const TR_CHAR_MAP = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' };

  function normalize(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
      .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (ch) => TR_CHAR_MAP[ch])
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function testAny(patterns, text) {
    if (!text || !patterns) return false;
    for (const pattern of patterns) {
      if (pattern.test(text)) return true;
    }
    return false;
  }

  function truncate(text, max) {
    if (!max || max <= 0 || text.length <= max) return text;
    let cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > max * 0.8) cut = cut.slice(0, lastSpace);
    return cut.trim();
  }

  function parseNumber(value) {
    if (typeof value === 'number') return value;
    let text = String(value || '').trim().toLowerCase();
    if (!text) return NaN;
    let multiplier = 1;
    if (/\d\s*k\b/.test(text)) multiplier = 1000;
    text = text.replace(/[^\d.,]/g, '');
    if (/^\d{1,3}([.,]\d{3})+$/.test(text)) text = text.replace(/[.,]/g, '');
    else text = text.replace(',', '.');
    const number = parseFloat(text);
    return Number.isFinite(number) ? number * multiplier : NaN;
  }

  const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SELECT', 'OPTION', 'TEXTAREA', 'SVG', 'BUTTON', 'TEMPLATE', 'INPUT']);

  function textOf(node, max = 300) {
    if (!node) return '';
    let output = '';
    const walk = (current) => {
      if (output.length >= max) return;
      if (current.nodeType === 3) {
        output += ` ${current.nodeValue}`;
        return;
      }
      if (current.nodeType !== 1) return;
      if (SKIP_TEXT_TAGS.has(String(current.tagName).toUpperCase())) return;
      for (const child of current.childNodes) walk(child);
    };
    walk(node);
    return output.replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /* ------------------------------------------------------------------ */
  /* Static data                                                         */
  /* ------------------------------------------------------------------ */

  const YES_WORDS = ['yes', 'evet', 'y', 'true', 'var', 'olur', 'uygun', 'i am', 'i do', 'i will', 'i have'];
  const NO_WORDS = ['no', 'hayir', 'n', 'false', 'yok', 'degil', 'i am not', 'i do not', 'i don t', 'i will not'];

  const WORK_MODES = {
    remote: {
      tr: 'Uzaktan',
      en: 'Remote',
      synonyms: ['remote', 'uzaktan', 'fully remote', 'tamamen uzaktan', 'evden', 'home office', 'work from home', 'wfh'],
      detect: /\bremote\b|\buzaktan|\bevden\b|home office|work from home|\bwfh\b/
    },
    hybrid: {
      tr: 'Hibrit',
      en: 'Hybrid',
      synonyms: ['hybrid', 'hibrit', 'karma', 'hybrid remote'],
      detect: /\bhybrid\b|\bhibrit\b/
    },
    onsite: {
      tr: 'Ofisten',
      en: 'On-site',
      synonyms: ['on site', 'onsite', 'ofisten', 'ofis', 'office', 'in office', 'in person', 'yerinde', 'isyerinde', 'office based'],
      detect: /\bon ?site\b|\bofisten\b|\bofis\b|\boffice\b|in person|\byerinde\b/
    }
  };

  const ENGLISH_LEVELS = {
    native: {
      tr: 'Ana dil',
      en: 'Native',
      synonyms: ['native', 'ana dil', 'anadil', 'mother tongue', 'native speaker', 'bilingual', 'iki dilli']
    },
    c2: {
      tr: 'C2 – Ustalık',
      en: 'C2 – Proficient',
      synonyms: ['c2', 'proficient', 'proficiency', 'mastery', 'full professional', 'ustalik', 'cok iyi', 'çok iyi']
    },
    c1: {
      tr: 'C1 – İleri',
      en: 'C1 – Advanced',
      synonyms: ['c1', 'advanced', 'ileri', 'fluent', 'akici', 'akıcı', 'professional working', 'ileri seviye']
    },
    b2: {
      tr: 'B2 – Orta üstü',
      en: 'B2 – Upper-Intermediate',
      synonyms: ['b2', 'upper intermediate', 'upper-intermediate', 'ortaustu', 'orta ustu', 'orta üstü', 'good']
    },
    b1: {
      tr: 'B1 – Orta',
      en: 'B1 – Intermediate',
      synonyms: ['b1', 'intermediate', 'orta', 'orta seviye']
    },
    a2: {
      tr: 'A2 – Temel',
      en: 'A2 – Elementary',
      synonyms: ['a2', 'elementary', 'pre intermediate', 'temel', 'temel seviye']
    },
    a1: {
      tr: 'A1 – Başlangıç',
      en: 'A1 – Beginner',
      synonyms: ['a1', 'beginner', 'basic', 'baslangic', 'başlangıç']
    }
  };

  const MILITARY_STATUSES = {
    completed: { tr: 'Yapıldı', en: 'Completed', synonyms: ['yapildi', 'yaptim', 'tamamlandi', 'tamamladim', 'terhis', 'completed', 'done', 'fulfilled'] },
    exempt: { tr: 'Muaf', en: 'Exempt', synonyms: ['muaf', 'muafim', 'muafiyet', 'exempt', 'exempted'] },
    postponed: { tr: 'Tecilli', en: 'Postponed', synonyms: ['tecilli', 'tecil', 'ertelendi', 'ertelenmis', 'postponed', 'deferred'] },
    not_applicable: { tr: 'Yükümlü değil', en: 'Not applicable', synonyms: ['yukumlu degil', 'yukumlu degilim', 'not applicable', 'n a', 'none', 'not required', 'yok'] }
  };

  const WORK_AUTHORIZATIONS = {
    citizen: {
      tr: 'Vatandaşım, çalışma izni gerekmiyor',
      en: 'Citizen – no work permit required',
      synonyms: ['citizen', 'vatandas', 'vatandasim', 'no permit required', 'izin gerekmiyor', 'authorized'],
      authorized: true
    },
    permit: {
      tr: 'Geçerli çalışma iznim var',
      en: 'I have a valid work permit',
      synonyms: ['work permit', 'valid work permit', 'permit', 'calisma iznim var', 'calisma izni var', 'authorized'],
      authorized: true
    },
    visa_required: {
      tr: 'Çalışma izni / vize gerekiyor',
      en: 'Requires a work permit / visa',
      synonyms: ['visa required', 'requires visa', 'require sponsorship', 'need visa', 'vize gerekli', 'izin gerekli', 'gerekiyor'],
      authorized: false
    }
  };

  const NOTICE_UNITS = {
    days: { tr: 'gün', en: ['day', 'days'], factor: 1 },
    weeks: { tr: 'hafta', en: ['week', 'weeks'], factor: 7 },
    months: { tr: 'ay', en: ['month', 'months'], factor: 30 }
  };

  const CURRENCY_ALIASES = {
    TRY: ['TRY', 'TL', 'Türk Lirası', 'Turkish Lira', 'TRY TL', 'TL TRY'],
    USD: ['USD', 'US Dollar', 'Dollar', 'Dolar', 'ABD Doları', 'USD Dollar'],
    EUR: ['EUR', 'Euro', 'Avro']
  };

  const COUNTRY_ALIASES = [
    ['türkiye', 'turkiye', 'turkey', 'tr', 'tur', 'republic of turkey', 'türkiye cumhuriyeti', 'turkiye cumhuriyeti'],
    ['germany', 'almanya', 'deutschland', 'de', 'deu'],
    ['united states', 'united states of america', 'usa', 'us', 'abd', 'amerika', 'amerika birlesik devletleri'],
    ['united kingdom', 'uk', 'gb', 'great britain', 'ingiltere', 'birlesik krallik', 'england'],
    ['netherlands', 'the netherlands', 'hollanda', 'holland', 'nl'],
    ['france', 'fransa', 'fr'],
    ['spain', 'ispanya', 'es'],
    ['italy', 'italya', 'it'],
    ['poland', 'polonya', 'pl'],
    ['ireland', 'irlanda', 'ie'],
    ['canada', 'kanada', 'ca'],
    ['azerbaijan', 'azerbaycan', 'az'],
    ['united arab emirates', 'uae', 'birlesik arap emirlikleri', 'bae'],
    ['switzerland', 'isvicre', 'ch'],
    ['austria', 'avusturya', 'at'],
    ['sweden', 'isvec', 'se'],
    ['portugal', 'portekiz', 'pt']
  ];

  const TR_WORDS = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'ad', 'adı', 'adınız', 'soyad', 'soyadı', 'soyadınız', 'telefon', 'numarası', 'adres', 'adresi', 'başvuru', 'başvur', 'başvurusu', 'gönder', 'lütfen', 'zorunlu', 'özgeçmiş', 'deneyim', 'eğitim', 'şehir', 'ülke', 'doğum', 'tarihi', 'hakkında', 'hakkımda', 'seçiniz', 'seçin', 'yükle', 'kaydet', 'devam', 'posta', 'maaş', 'beklentisi', 'iş', 'ilan', 'pozisyon', 'kişisel', 'bilgiler', 'bilgileri', 'mesaj', 'yazı', 'ön', 'veya', 'değil', 'evet', 'hayır', 'nedir', 'misiniz', 'mısınız', 'giriş', 'üye', 'kariyer', 'ücret', 'askerlik', 'ihbar', 'süresi']);
  const EN_WORDS = new Set(['the', 'and', 'for', 'your', 'you', 'name', 'first', 'last', 'email', 'phone', 'address', 'apply', 'application', 'submit', 'please', 'required', 'resume', 'experience', 'education', 'city', 'country', 'select', 'upload', 'save', 'continue', 'about', 'cover', 'letter', 'salary', 'job', 'work', 'are', 'is', 'of', 'to', 'with', 'yes', 'no', 'what', 'how', 'why', 'optional', 'attach', 'information', 'details', 'position', 'expected', 'notice', 'period']);

  /* ------------------------------------------------------------------ */
  /* Matching rules                                                      */
  /* ------------------------------------------------------------------ */

  const FULL_NAME_STRONG = [/\bfull ?name\b/, /\bad ?soyad/, /\badi(niz)? ?soyadi/, /\bisim ?soyisim/, /\bisminiz ?soyisminiz/, /\bname (and )?surname\b/, /\blegal name\b/];
  const NAME_NEGATIVES = [/compan|\bsirket|\bfirma|\buser ?name|kullanici|\bfile\b|\bdosya|\bmiddle\b|\bnick|referen|referans|emergency|\bacil\b|\bschool|\bokul|universit|manager|yonetici|recruiter|employer|isveren|\bproject|\bproje|\bcard\b|\bkart\b|\bbank|\bfather|\bmother|\banne\b|\bbaba\b|spouse|business|domain|\bevent\b|\bdisplay\b/];
  const AMBIGUOUS_NAME = /^(your |candidate |applicant )?name$|^isim$|^isminiz$|^adi(niz)?$/;

  const LINK_ACCEPTS = ['input', 'textarea', 'combobox', 'editable'];
  const TEXT_ACCEPTS = ['input', 'textarea', 'combobox', 'editable'];
  const SHORT_ACCEPTS = ['input', 'textarea', 'select', 'radio', 'combobox', 'editable'];
  const CHOICE_ACCEPTS = ['input', 'select', 'radio', 'checkbox', 'combobox'];
  const LONG_ACCEPTS = ['textarea', 'editable'];

  const RULES = [
    {
      key: 'email', category: 'personal', accepts: TEXT_ACCEPTS, typeHint: 'email', autocomplete: ['email'],
      patterns: [/\be ?mail\b/, /\be ?posta\b/, /\beposta\b/, /\bmail\b/],
      negatives: [/referen|referans|\bmanager\b|yonetici|recruiter|referrer/]
    },
    {
      key: 'phone', category: 'personal', accepts: ['input', 'editable'], typeHint: 'tel', autocomplete: ['tel', 'tel-national'],
      patterns: [/\bphone\b/, /telephone/, /\bmobile\b/, /\bcell\b/, /\btelefon/, /\btel\b/, /\bgsm\b/, /\bcep\b/, /\bcontact number\b/, /\bphone number\b/],
      negatives: [/country code|ulke kodu|alan kodu|area code|\bext\b|extension|\bfax\b|\bfaks\b|emergency|\bacil\b|referen|referans/]
    },
    {
      key: 'firstName', category: 'personal', accepts: TEXT_ACCEPTS, autocomplete: ['given-name'],
      patterns: [/\bfirst ?name\b/, /\bgiven ?name\b/, /\bfname\b/, /\bforename\b/, /\bfirstname\b/, /\bfirst_name\b/, /^ad$/, /^adi(niz)?$/, /^isim$/, /^isminiz$/, /^first$/, /\bname first\b/],
      negatives: NAME_NEGATIVES.concat(FULL_NAME_STRONG, [/\blast\b|\bsur ?name|\bsoyad|\bsoy ?isim|\bfamily/])
    },
    {
      key: 'lastName', category: 'personal', accepts: TEXT_ACCEPTS, autocomplete: ['family-name'],
      patterns: [/\blast ?name\b/, /\bsur ?name\b/, /\bfamily ?name\b/, /\blname\b/, /\blastname\b/, /\blast_name\b/, /\bsoyad/, /\bsoy ?isim/, /^last$/, /\bname last\b/],
      negatives: NAME_NEGATIVES.concat(FULL_NAME_STRONG)
    },
    {
      key: 'fullName', category: 'personal', accepts: TEXT_ACCEPTS, autocomplete: ['name'],
      patterns: FULL_NAME_STRONG.concat([/^(your |candidate |applicant )?name$/, /^isim$/, /^isminiz$/, /^adi(niz)?$/, /^aday adi$/]),
      negatives: NAME_NEGATIVES
    },
    {
      key: 'birthDate', category: 'personal', accepts: ['input', 'editable'], autocomplete: ['bday'],
      patterns: [/\bbirth ?date\b/, /\bdate of birth\b/, /\bdob\b/, /\bbirthday\b/, /\bdogum ?tarih/, /\bdogum ?gunu/, /\bbirth\b/, /\bdogum\b/],
      negatives: [/place|\byer/, /\bcity\b|\bsehir|country|\bulke|\bil\b/]
    },
    {
      key: 'postalCode', category: 'personal', accepts: ['input', 'editable'], autocomplete: ['postal-code'],
      patterns: [/\bpostal\b/, /\bzip\b/, /\bpost ?code\b/, /\bposta ?kodu/, /\bpostcode\b/]
    },
    { key: 'linkedin', category: 'links', accepts: LINK_ACCEPTS, patterns: [/\blinked ?in\b/] },
    { key: 'github', category: 'links', accepts: LINK_ACCEPTS, patterns: [/\bgit ?hub\b/] },
    { key: 'kaggle', category: 'links', accepts: LINK_ACCEPTS, patterns: [/\bkaggle\b/] },
    { key: 'twitter', category: 'links', accepts: LINK_ACCEPTS, patterns: [/\btwitter\b/, /^x$/, /\bx (profile|url|handle|account|hesab)/, /\bx com\b/] },
    {
      key: 'medium', category: 'links', accepts: LINK_ACCEPTS, patterns: [/\bmedium\b/],
      negatives: [/how did you hear|nereden duydu|\bsource\b|\bkaynak\b/]
    },
    { key: 'portfolio', category: 'links', accepts: LINK_ACCEPTS, patterns: [/\bportfoli?o\b/, /\bportfolyo/, /\bbehance\b/, /\bdribbble\b/] },
    {
      key: 'website', category: 'links', accepts: LINK_ACCEPTS, typeHint: 'url', autocomplete: ['url'],
      patterns: [/\bweb ?site/, /\bweb ?sitesi/, /\bpersonal (site|page|url|web)/, /\bkisisel (site|sayfa|web)/, /\bhomepage\b/, /\bblog\b/, /\burl\b/, /\bweb\b/, /\bother (link|url|profile|website)/, /\bdiger (link|baglanti)/, /\blinks?\b/, /\bbaglanti/],
      negatives: [/linked ?in|git ?hub|kaggle|twitter|\bmedium\b|portfoli?o|portfolyo|compan|\bsirket|\bfirma|employer|isveren|job (post|ad|listing)|\bilan|video|youtube/]
    },
    {
      key: 'salaryCurrency', category: 'salary', accepts: ['select', 'radio', 'combobox'],
      patterns: [/\bcurrency\b/, /\bpara birimi/, /\bdoviz\b/, /\bkur\b/]
    },
    {
      key: 'salary', category: 'salary', accepts: SHORT_ACCEPTS,
      patterns: [/\bsalary\b/, /\bcompensation\b/, /\bmaas/, /\bucret/, /\bexpected (pay|ctc|compensation|package)/, /\bdesired pay\b/, /\bpay (expectation|range)/, /\bctc\b/, /\bwage/, /\bnet (maas|ucret)/, /\bbrut (maas|ucret)/, /\bremuneration/],
      negatives: [/\bcurrent (salary|ctc|compensation|pay)|mevcut maas|su ?anki maas|guncel maas|\bson maas|\bcurrency\b|para birimi|\bdoviz\b/]
    },
    {
      key: 'noticePeriod', category: 'preferences', accepts: SHORT_ACCEPTS,
      patterns: [/\bnotice\b/, /\bihbar/, /\bavailab(le|ility) to start/, /\bwhen (can|could) you (start|join)/, /\bstart(ing)? date\b/, /\bearliest (start|join)/, /\bise baslama/, /\bbaslama tarih/, /\bne zaman (baslayabilir|ise)/, /\bmusait(lik)?\b/, /\bjoining (date|time)/],
      negatives: [/\bend date\b|\bbitis/]
    },
    {
      key: 'workMode', category: 'preferences', accepts: ['input', 'select', 'radio', 'checkbox', 'checkboxGroup', 'combobox'],
      patterns: [/\bwork ?(mode|type|model|arrangement|style|setup|place type|location preference|preference)/, /\bworking (mode|model|arrangement|style)/, /\bworkplace (type|preference)/, /\bcalisma (modeli|sekli|tercihi|modu|bicimi|duzeni|ortami)/, /\bis modeli/, /\bremote\b/, /\buzaktan/, /\bhybrid\b/, /\bhibrit/, /\bon ?site\b/, /\bofisten/, /\bin office\b/],
      negatives: [/relocat|\btasin/]
    },
    {
      key: 'militaryStatus', category: 'preferences', accepts: SHORT_ACCEPTS,
      patterns: [/\bmilitary\b/, /\baskerlik/, /\baskeri\b/, /\barmy\b/]
    },
    {
      key: 'englishLevel', category: 'preferences', accepts: SHORT_ACCEPTS,
      patterns: [/\benglish (level|proficiency|fluency|skill|competenc)/, /\bproficiency in english/, /\bfluency in english/, /\bingilizce (seviye|bilgi|dil)/, /\bingilizce$/, /\bdil seviyesi/, /\blanguage (level|proficiency|skill)/],
      negatives: [/program|coding|java|python|deutsch|german|french|fransiz|spanish|ispanyol|arabic|arapca|turkce|turkish/]
    },
    {
      key: 'requiresSponsorship', category: 'preferences', accepts: CHOICE_ACCEPTS,
      patterns: [/\bsponsor/, /\bvize (destegi|sponsor)/, /\bvisa (support|sponsor)/]
    },
    {
      key: 'workAuthorization', category: 'preferences', accepts: ['input', 'textarea', 'select', 'radio', 'checkbox'],
      patterns: [/\bwork (permit|authori[sz]ation|eligibility|visa)/, /\bauthori[sz]ed to work/, /\bright to work/, /\beligib(le|ility) to work/, /\blegally (authori[sz]ed|eligible|allowed|permitted)/, /\bcalisma izn/, /\bvisa\b/, /\bvize\b/],
      negatives: [/sponsor/]
    },
    {
      key: 'willingToRelocate', category: 'preferences', accepts: CHOICE_ACCEPTS,
      patterns: [/\brelocat/, /\btasinma/, /\btasinabilir/, /\bsehir degistir/, /\byer degistir/]
    },
    {
      key: 'yearsOfExperience', category: 'career', accepts: ['input', 'select', 'radio', 'combobox', 'editable'],
      patterns: [/\byears? of (professional |work |relevant |total |industry )?experience/, /\bexperience (in )?years/, /\btotal experience/, /\bhow many years/, /\bkac yil/, /\b(deneyim|tecrube) (suresi|yili)/, /\byil(lik)? (deneyim|tecrube)/, /\btoplam (deneyim|tecrube)/]
    },
    {
      key: 'currentTitle', category: 'career', accepts: TEXT_ACCEPTS, autocomplete: ['organization-title'],
      patterns: [/\b(current|present|mevcut|guncel|su ?anki|son) (job )?(title|position|role|unvan|pozisyon|gorev)/, /\bjob title\b/, /\bunvan/, /\bis unvani/, /\bheadline\b/, /\boccupation\b/, /\bmeslek/, /^title$/, /^position$/, /^pozisyon$/],
      negatives: [/applying|\bbasvur|desired|istenen|\bhedef|\btarget|salutation|\bhitap|\bprefix\b|\bmr\b|compan|\bsirket|\bfirma/]
    },
    {
      key: 'currentCompany', category: 'career', accepts: TEXT_ACCEPTS, autocomplete: ['organization'],
      patterns: [/\b(current|present|mevcut|su ?anki|son) (company|employer|sirket|firma|isveren|kurum|organi[sz]ation)/, /\bcompany( name)?$/, /\bemployer\b/, /\bcalistiginiz (sirket|firma|kurum)/, /\bsirket adi/, /\bfirma adi/],
      negatives: [/previous|onceki|former|referen|referans|website|\burl\b|address|\badres|phone|telefon|e ?mail|\bsize\b|sektor|industry/]
    },
    {
      key: 'coverLetter', category: 'coverLetter', accepts: LONG_ACCEPTS, once: true,
      patterns: [/\bcover(ing)? ?letter/, /\bmotivation/, /\bmotivasyon/, /\bon ?yazi/, /\bniyet mektubu/, /\bstatement\b/, /\bwhy (do you want|are you interested|would you like|should we|us\b|this)/, /\bneden (biz|bu|sirket|bizimle|burada)/, /\bmessage to (the )?(hiring|recruit|team|company)/, /^(your )?message$/, /\bmesaj/, /\bek (bilgi|aciklama|not)/, /\badditional (information|info|comments|details|notes)/, /\banything else/, /\beklemek istedi/, /\bletter\b/]
    },
    {
      key: 'summary', category: 'resume', accepts: LONG_ACCEPTS, once: true,
      patterns: [/\bsummary\b/, /\babout (me|you|yourself)\b/, /\bbio(graphy)?\b/, /\bhakkimda/, /\bhakkinizda/, /\bozet/, /\bkendinizi? (tanit|anlat|kisaca)/, /\bkisaca (kendiniz|siz)/, /\bozgecmis/, /\bcv\b/, /\bresume\b/, /\bintroduce yourself/, /\btell us (about )?(yourself|more about you)/, /\bself introduction/, /\bprofile\b/, /\bprofil\b/, /\bdescribe yourself/],
      negatives: [/upload|\byukle|\bdosya|\bfile\b|attach|\burl\b|\blink/]
    },
    {
      key: 'experience', category: 'resume', accepts: LONG_ACCEPTS, once: true,
      patterns: [/\bexperience/, /\bdeneyim/, /\btecrube/, /\bwork history/, /\bemployment history/, /\bis gecmisi/, /\bkariyer gecmisi/, /\bcareer (history|background)/, /\bprofessional background/, /\bprevious (jobs|roles|positions)/],
      negatives: [/\byears?\b|\byil\b|suresi|\blevel\b|seviye|upload|\byukle|\bfile\b/]
    },
    {
      key: 'education', category: 'resume', accepts: LONG_ACCEPTS, once: true,
      patterns: [/\beducation/, /\begitim/, /\bacademic/, /\bakademik/, /universit/, /\bschool/, /\bokul/, /\bdegree/, /\bdiploma/, /\bmezun/, /\bogrenim/, /\bqualification/]
    },
    {
      key: 'resumeFile', category: 'documents', accepts: ['file'], once: true,
      patterns: [/\bcv\b/, /\bresume\b/, /\bozgecmis/, /\bcurriculum/, /\bupload/, /\byukle/, /\battach/, /\bek dosya/, /\bdosya/, /\bdocument\b/, /\bbelge/],
      negatives: [/cover|on ?yazi|motivasyon|photo|foto|image|resim|portre|picture|avatar|headshot|kimlik|passport|id card|transcript|transkript/]
    },
    {
      key: 'address', category: 'personal', accepts: ['input', 'textarea', 'editable'], autocomplete: ['street-address', 'address-line1'],
      patterns: [/\baddress\b/, /\badres/, /\bstreet\b/, /\bsokak/, /\bmahalle/, /\bcadde/],
      negatives: [/e ?mail|e ?posta|\bmail\b|\bweb|\burl\b|\bip\b|line ?2|\bcity\b|\bsehir|country|\bulke|postal|\bzip\b|posta kodu|billing|fatura|company|\bsirket/]
    },
    {
      key: 'city', category: 'personal', accepts: SHORT_ACCEPTS, autocomplete: ['address-level2'],
      patterns: [/\bcity\b/, /\btown\b/, /\bsehir/, /^il$/, /\bil ?ilce/, /\byasadiginiz (il|sehir)/, /\bikamet (ettiginiz )?(il|sehir)/, /\blocality\b/],
      negatives: [/birth|dogum|country|\bulke|preferred|tercih|relocat|\btasin/]
    },
    {
      key: 'country', category: 'personal', accepts: SHORT_ACCEPTS, autocomplete: ['country', 'country-name'],
      patterns: [/\bcountry\b/, /\bulke/, /\bcountry of residence/, /\bresiden(ce|t) country/, /\bikamet (ettiginiz )?ulke/],
      negatives: [/\bcountry code\b|\bulke kodu|phone|telefon|\bdial code|birth|dogum|citizenship|nationality|uyruk|vatandas/]
    },
    {
      key: 'location', category: 'personal', accepts: SHORT_ACCEPTS,
      patterns: [/\blocation\b/, /\bkonum/, /\blokasyon/, /\bwhere (are you|do you) (based|live|located|reside)/, /\bcurrent (location|city)/, /\bnerede yasiyor/, /\bresiden(ce|t)\b/, /\bikamet\b/, /\byasadiginiz yer/],
      negatives: [/preferred|tercih|desired|job location|is yeri|relocat|\btasin|office/]
    }
  ];

  const RULE_BY_KEY = RULES.reduce((map, rule) => {
    map[rule.key] = rule;
    return map;
  }, {});

  const MIN_SCORE = 3;

  /* ------------------------------------------------------------------ */
  /* DOM discovery                                                       */
  /* ------------------------------------------------------------------ */

  const CONTROL_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="spinbutton"]',
    '[aria-haspopup="listbox"]'
  ].join(', ');
  const TEXT_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'month', 'search']);

  function collectControls(root, output = [], seen = new Set()) {
    if (!root || typeof root.querySelectorAll !== 'function' || seen.has(root)) return output;
    seen.add(root);
    root.querySelectorAll(CONTROL_SELECTOR).forEach((el) => output.push(el));
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) collectControls(el.shadowRoot, output, seen);
    });
    // Used only when a single top-frame injection has to see same-origin child frames.
    // Cross-origin frames are separate injections and must not be walked from here.
    if (globalThis.__ApplyPilotWalkFrames) {
      root.querySelectorAll('iframe, frame').forEach((frame) => {
        try {
          if (frame.contentDocument) collectControls(frame.contentDocument, output, seen);
        } catch (_) { /* cross-origin; filled from its own frame */ }
      });
    }
    return unique(output);
  }

  function queryDeep(selector, root = document) {
    const found = [];
    const visit = (node, seen = new Set()) => {
      if (!node || typeof node.querySelectorAll !== 'function' || seen.has(node)) return;
      seen.add(node);
      node.querySelectorAll(selector).forEach((el) => found.push(el));
      node.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) visit(el.shadowRoot, seen);
      });
    };
    visit(root);
    return found;
  }

  function getKind(el) {
    const tag = String(el.tagName).toLowerCase();
    const role = String(el.getAttribute('role') || '').toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'input') {
      const type = String(el.type || 'text').toLowerCase();
      if (type === 'radio') return 'radio';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'file') return 'file';
      if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
      return TEXT_INPUT_TYPES.has(type) || type === '' ? 'input' : null;
    }
    if (role === 'radio') return 'radio';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
    if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') return 'editable';
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return 'editable';
    return null;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
  }

  function isEffectivelyHidden(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'hidden') return true;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (parseFloat(style.opacity) === 0) return true;
    if (style.clipPath === 'inset(50%)' || /rect\(0px/.test(style.clip || '')) return true;
    const rects = el.getClientRects();
    if (!rects.length) return true;
    const box = el.getBoundingClientRect();
    if (box.width < 2 && box.height < 2) return true;
    return false;
  }

  function hasVisibleAncestor(el) {
    let node = el.parentElement;
    for (let i = 0; i < 8 && node && node !== document.body; i += 1, node = node.parentElement) {
      if (!isVisible(node)) continue;
      const box = node.getBoundingClientRect();
      if (box.width > 8 && box.height > 8) return true;
    }
    return false;
  }

  function isUsable(el, kind) {
    if (el.disabled) return false;
    const signature = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('class') || ''}`.toLowerCase();
    if (/captcha|honeypot|\bhp_|bot.?field/.test(signature)) return false;
    if (kind === 'file') {
      return !isEffectivelyHidden(el) || hasVisibleAncestor(el) || Array.from(el.labels || []).some((label) => !isEffectivelyHidden(label));
    }
    if (isEffectivelyHidden(el)) return hasVisibleAncestor(el) && kind !== 'radio' && kind !== 'checkbox';
    return true;
  }

  function getRootOf(el) {
    const root = el.getRootNode ? el.getRootNode() : document;
    return root && typeof root.querySelector === 'function' ? root : document;
  }

  function byId(el, id) {
    if (!id) return null;
    try {
      return getRootOf(el).querySelector(`#${CSS.escape(id)}`) || document.getElementById(id);
    } catch (_) {
      return null;
    }
  }

  function countControls(node) {
    if (!node || typeof node.querySelectorAll !== 'function') return 0;
    return node.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"]').length;
  }

  function getLabelText(el) {
    const parts = [];
    const seen = new Set();
    const add = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      const text = textOf(node);
      if (text) parts.push(text);
    };

    if (el.labels && el.labels.length) {
      Array.from(el.labels).forEach(add);
    } else if (el.id) {
      try {
        getRootOf(el).querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach(add);
      } catch (_) { /* invalid id */ }
    }
    add(el.closest('label'));

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) labelledBy.split(/\s+/).forEach((id) => add(byId(el, id)));

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) parts.push(ariaLabel);

    return parts.join(' | ').slice(0, 400);
  }

  function shortText(value, max = 80) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text && text.length <= max ? text : '';
  }

  /** Closest visual caption — prefers a short nearby label over a shared row heading. */
  function getNearbyLabel(el) {
    const official = getLabelText(el);
    if (official && official.length <= 90 && !/\bfirst name\b.+\blast name\b/i.test(official) && !/\blast name\b.+\bfirst name\b/i.test(official)) {
      return official;
    }

    const candidates = [];
    const push = (value) => {
      const text = shortText(value, 90);
      if (text) candidates.push(text);
    };

    let node = el;
    for (let depth = 0; depth < 5 && node && node !== document.body; depth += 1, node = node.parentElement) {
      push(node.getAttribute && (node.getAttribute('data-label') || node.getAttribute('data-field-label') || node.getAttribute('data-placeholder')));
    }

    let sibling = el.previousElementSibling;
    for (let i = 0; i < 4 && sibling; i += 1, sibling = sibling.previousElementSibling) {
      if (countControls(sibling) > 0) break;
      push(textOf(sibling, 90));
      if (candidates.length) break;
    }

    const parent = el.parentElement;
    if (parent) {
      for (const child of Array.from(parent.children)) {
        if (child === el || child.contains(el)) break;
        if (countControls(child) > 0) continue;
        const text = textOf(child, 90);
        if (shortText(text, 70)) {
          push(text);
          break;
        }
      }
      const labeled = parent.querySelector('label, legend, p, span, [class*="label" i], [class*="Label"]');
      if (labeled && !labeled.contains(el)) push(textOf(labeled, 90));
    }

    if (official) candidates.unshift(official);
    const uniqueCandidates = unique(candidates);
    const specific = uniqueCandidates.find((text) =>
      /first name|last name|e-?mail|phone|linkedin|country|resume|cv|soyad|telefon|ulke/i.test(text) && text.length <= 70
    );
    return specific || uniqueCandidates[0] || '';
  }

  function getDescribedByText(el) {
    const ids = el.getAttribute('aria-describedby');
    if (!ids) return '';
    return ids.split(/\s+/).map((id) => textOf(byId(el, id), 150)).join(' ');
  }

  /** Text from the nearest wrapper that contains only this control, or its preceding siblings. */
  function getContextText(el) {
    let top = el;
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = top.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      if (countControls(parent) > 1) break;
      top = parent;
    }
    let text = top !== el ? textOf(top, 200) : '';
    let sibling = top.previousElementSibling;
    for (let i = 0; i < 3 && sibling && !text; i += 1, sibling = sibling.previousElementSibling) {
      if (countControls(sibling) === 0) text = textOf(sibling, 200);
    }
    return text;
  }

  function getOptionLabel(el) {
    let text = '';
    if (el.labels && el.labels.length) text = Array.from(el.labels).map((label) => textOf(label, 120)).join(' ');
    if (!text) {
      const wrapping = el.closest('label');
      if (wrapping) text = textOf(wrapping, 120);
    }
    if (!text) text = el.getAttribute('aria-label') || '';
    if (!text) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) text = labelledBy.split(/\s+/).map((id) => textOf(byId(el, id), 120)).join(' ');
    }
    if (!text) {
      let node = el.nextSibling;
      for (let i = 0; i < 3 && node && !text; i += 1, node = node.nextSibling) {
        if (node.nodeType === 3) text = node.nodeValue.trim();
        else if (node.nodeType === 1 && countControls(node) === 0) text = textOf(node, 120);
      }
    }
    if (!text && el.parentElement && countControls(el.parentElement) === 1) text = textOf(el.parentElement, 120);
    return (text || el.value || '').trim().slice(0, 120);
  }

  function getGroupQuestion(elements, options) {
    const first = elements[0];
    const parts = [];
    // A wrapper only describes this question if it holds no other form controls.
    const ownsOnlyGroup = (node) => node && elements.every((el) => node.contains(el)) && countControls(node) <= elements.length;

    const fieldset = first.closest('fieldset');
    if (ownsOnlyGroup(fieldset)) {
      const legend = fieldset.querySelector('legend');
      if (legend) parts.push(textOf(legend));
    }

    const group = first.closest('[role="radiogroup"], [role="group"]');
    if (ownsOnlyGroup(group)) {
      const ariaLabel = group.getAttribute('aria-label');
      if (ariaLabel) parts.push(ariaLabel);
      const labelledBy = group.getAttribute('aria-labelledby');
      if (labelledBy) labelledBy.split(/\s+/).forEach((id) => parts.push(textOf(byId(first, id))));
    }

    let container = first.parentElement;
    while (container && !elements.every((el) => container.contains(el))) container = container.parentElement;
    if (!container) container = first.parentElement || first;

    let top = container;
    for (let i = 0; i < 4; i += 1) {
      const parent = top.parentElement;
      if (!parent || parent === document.body || countControls(parent) !== countControls(container)) break;
      top = parent;
    }

    if (!parts.join('').trim()) {
      let own = textOf(top, 500);
      for (const option of options) {
        if (option.text) own = own.split(option.text).join(' ');
      }
      own = own.replace(/\s+/g, ' ').trim();
      if (own) parts.push(own);

      let sibling = top.previousElementSibling;
      for (let i = 0; i < 2 && sibling && !own; i += 1, sibling = sibling.previousElementSibling) {
        if (countControls(sibling) === 0) {
          const text = textOf(sibling, 200);
          if (text) {
            parts.push(text);
            break;
          }
        }
      }
    }

    return { question: parts.filter(Boolean).join(' | ').slice(0, 400), container: top };
  }

  function buildOption(el, text, value) {
    return { el, text, value, norm: normalize(text), normValue: normalize(value) };
  }

  function finalizeGroup(group) {
    const elements = group.elements;
    if (group.kind === 'checkbox' && elements.length === 1) {
      const el = elements[0];
      return { kind: 'checkbox', el, highlightTarget: el.closest('label') || el };
    }
    const options = elements.map((el) => buildOption(el, getOptionLabel(el), el.value));
    const { question, container } = getGroupQuestion(elements, options);
    return {
      kind: group.kind === 'radio' ? 'radio' : 'checkboxGroup',
      el: elements[0],
      elements,
      options,
      question,
      highlightTarget: container
    };
  }

  function collectUnits() {
    const controls = collectControls(document);
    const units = [];
    const groups = new Map();
    const formKeys = new Map();

    const formKey = (el) => {
      const form = el.form || el.closest('form');
      if (!form) return 'root';
      if (!formKeys.has(form)) formKeys.set(form, `form${formKeys.size}`);
      return formKeys.get(form);
    };

    for (const el of controls) {
      const kind = getKind(el);
      if (!kind) continue;

      const innerBetter = controls.some((other) => {
        if (other === el || !el.contains(other)) return false;
        const otherKind = getKind(other);
        return Boolean(otherKind && !isEffectivelyHidden(other) && isUsable(other, otherKind));
      });
      if (innerBetter) continue;

      const hiddenInsideVisibleHost = isEffectivelyHidden(el) && controls.some((other) => other !== el && other.contains(el) && !isEffectivelyHidden(other) && getKind(other));
      if (hiddenInsideVisibleHost) continue;

      if (!isUsable(el, kind)) continue;

      if (kind === 'radio' || kind === 'checkbox') {
        const name = el.getAttribute('name');
        if (name) {
          const key = `${kind}::${formKey(el)}::${name}`;
          if (!groups.has(key)) {
            const group = { kind, elements: [] };
            groups.set(key, group);
            units.push(group);
          }
          groups.get(key).elements.push(el);
          continue;
        }
        units.push({ kind, elements: [el] });
        continue;
      }
      units.push({ kind, el });
    }

    return units.map((unit) => (unit.elements ? finalizeGroup(unit) : unit));
  }

  function describe(unit) {
    const el = unit.el;
    const attrs = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('data-automation-id'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-qa'),
      el.getAttribute('data-test'),
      el.getAttribute('data-cy'),
      el.getAttribute('data-field'),
      el.getAttribute('data-name'),
      el.getAttribute('formcontrolname'),
      el.getAttribute('ng-model'),
      el.getAttribute('v-model')
    ].filter(Boolean).join(' ');

    let label = '';
    let placeholder = '';
    let context = '';

    if (unit.kind === 'radio' || unit.kind === 'checkboxGroup') {
      label = unit.question || getNearbyLabel(el);
      if (!label) context = getContextText(unit.highlightTarget || el);
    } else {
      label = getNearbyLabel(el);
      placeholder = [el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('data-placeholder'), getDescribedByText(el)]
        .filter(Boolean)
        .join(' ');
      context = getContextText(el);
    }

    if (!label) {
      const root = el.getRootNode && el.getRootNode();
      const host = root && root.host;
      if (host && host !== el) {
        label = getLabelText(host) || host.getAttribute('aria-label') || host.getAttribute('placeholder') || '';
      }
    }

    const autocomplete = String(el.getAttribute('autocomplete') || '').toLowerCase();
    return {
      attrs: normalize(attrs),
      label: normalize(label),
      placeholder: normalize(placeholder),
      context: normalize(context),
      acTokens: autocomplete.split(/\s+/).filter((token) => token && token !== 'on' && token !== 'off'),
      raw: [label, placeholder, context, attrs].filter(Boolean).join(' ')
    };
  }

  /* ------------------------------------------------------------------ */
  /* Scoring                                                             */
  /* ------------------------------------------------------------------ */

  function scoreRule(rule, desc, unit) {
    if (!rule.accepts.includes(unit.kind)) return 0;

    if (rule.autocomplete && desc.acTokens.length && rule.autocomplete.some((token) => desc.acTokens.includes(token))) {
      return 100;
    }

    const primary = [desc.label, desc.placeholder].filter(Boolean).join(' ');
    const secondary = [desc.attrs, desc.context].filter(Boolean).join(' ');
    if (rule.negatives && primary && testAny(rule.negatives, primary) && !testAny(rule.patterns, primary)) return 0;
    if (rule.negatives && !primary && testAny(rule.negatives, secondary) && !testAny(rule.patterns, secondary)) return 0;

    let score = 0;
    if (testAny(rule.patterns, desc.label)) score += 10;
    if (testAny(rule.patterns, desc.placeholder)) score += 6;
    if (testAny(rule.patterns, desc.attrs)) score += 5;
    if (testAny(rule.patterns, desc.context)) score += desc.label ? 2 : 4;

    if (rule.typeHint && unit.kind === 'input' && unit.el.type === rule.typeHint) {
      if (score > 0) score += 10;
      else if (!desc.label) score += 8;
    }
    return score;
  }

  function matchUnits(units) {
    const matches = [];
    for (const unit of units) {
      const desc = describe(unit);
      let best = null;
      for (const rule of RULES) {
        const score = scoreRule(rule, desc, unit);
        if (score > 0 && (!best || score > best.score)) best = { rule, score };
      }
      if (best && best.score >= MIN_SCORE) matches.push({ unit, desc, rule: best.rule, score: best.score });
    }

    // "Name" + "Surname" layout: the ambiguous "Name" field is the first name.
    if (matches.some((match) => match.rule.key === 'lastName')) {
      for (const match of matches) {
        if (match.rule.key === 'fullName' && (AMBIGUOUS_NAME.test(match.desc.label) || (!match.desc.label && AMBIGUOUS_NAME.test(match.desc.attrs)))) {
          match.rule = RULE_BY_KEY.firstName;
        }
      }
    }

    // Shared row captions like "First name Last name" — left field is first, right is last.
    const namePair = matches.filter((match) => /first name|given name|ad[iı]n[iı]z|soyad/i.test(`${match.desc.label} ${match.desc.context}`) && ['firstName', 'lastName', 'fullName'].includes(match.rule.key));
    if (namePair.length === 2) {
      namePair.sort((a, b) => a.unit.el.getBoundingClientRect().left - b.unit.el.getBoundingClientRect().left);
      namePair[0].rule = RULE_BY_KEY.firstName;
      namePair[1].rule = RULE_BY_KEY.lastName;
    }

    // Long texts (cover letter, summary …) go into a single best field only.
    const bestOnce = new Map();
    for (const match of matches) {
      if (!match.rule.once) continue;
      const current = bestOnce.get(match.rule.key);
      if (!current || match.score > current.score) bestOnce.set(match.rule.key, match);
    }
    return matches.filter((match) => !match.rule.once || bestOnce.get(match.rule.key) === match);
  }

  /* ------------------------------------------------------------------ */
  /* Language detection                                                  */
  /* ------------------------------------------------------------------ */

  function detectLanguage() {
    const meta = document.querySelector('meta[http-equiv="content-language" i]');
    const htmlLang = String(document.documentElement.getAttribute('lang') || (meta && meta.getAttribute('content')) || '').toLowerCase();

    let trScore = 0;
    let enScore = 0;
    if (htmlLang.startsWith('tr')) trScore += 6;
    else if (htmlLang.startsWith('en')) enScore += 3;

    const chunks = [document.title || ''];
    let length = 0;
    const nodes = document.querySelectorAll('label, legend, h1, h2, h3, h4, button, th, [placeholder], [aria-label]');
    for (const node of nodes) {
      if (length > 6000) break;
      const isField = node.tagName === 'INPUT' || node.tagName === 'TEXTAREA';
      const text = `${node.getAttribute('placeholder') || ''} ${node.getAttribute('aria-label') || ''} ${isField ? '' : node.textContent || ''}`;
      chunks.push(text);
      length += text.length;
    }
    if (length < 400 && document.body) chunks.push(String(document.body.innerText || '').slice(0, 4000));

    const sample = chunks.join(' ');
    const turkishChars = (sample.match(/[çğışöüÇĞİŞÖÜ]/g) || []).length;
    trScore += Math.min(turkishChars / 6, 12);

    const words = sample.toLowerCase().split(/[^a-zçğıöşü]+/).filter(Boolean);
    for (const word of words) {
      if (TR_WORDS.has(word)) trScore += 1;
      else if (EN_WORDS.has(word)) enScore += 1;
    }

    return {
      lang: trScore > enScore ? 'tr' : 'en',
      htmlLang,
      scores: { tr: Math.round(trScore), en: Math.round(enScore) }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Value resolution                                                    */
  /* ------------------------------------------------------------------ */

  function pick(ctx, path) {
    const value = path.split('.').reduce((acc, key) => (acc !== null && acc !== undefined ? acc[key] : undefined), ctx.profile);
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function textValue(text) {
    return text ? { text } : null;
  }

  function langText(ctx, field) {
    const primary = pick(ctx, `${ctx.lang}.${field}`);
    if (primary) return primary;
    if (ctx.settings.fallbackToOtherLanguage) return pick(ctx, `${ctx.lang === 'tr' ? 'en' : 'tr'}.${field}`);
    return '';
  }

  function yesNoValue(answer, lang) {
    if (answer !== 'yes' && answer !== 'no') return null;
    const yes = answer === 'yes';
    return {
      bool: yes,
      text: yes ? (lang === 'tr' ? 'Evet' : 'Yes') : (lang === 'tr' ? 'Hayır' : 'No'),
      candidates: yes ? ['yes', 'evet'] : ['no', 'hayir']
    };
  }

  function isoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatDate(iso, hint, lang) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return iso || '';
    const [, y, m, d] = match;
    const h = String(hint || '').toLowerCase();
    if (/yyyy[-/.]mm[-/.]dd/.test(h)) return `${y}-${m}-${d}`;
    if (/mm\/dd\/yy/.test(h)) return `${m}/${d}/${y}`;
    if (/(dd|gg)\/(mm|aa)\/(yy)/.test(h)) return `${d}/${m}/${y}`;
    if (/(dd|gg)\.(mm|aa)\.(yy)/.test(h)) return `${d}.${m}.${y}`;
    if (/(dd|gg)-(mm|aa)-(yy)/.test(h)) return `${d}-${m}-${y}`;
    return lang === 'tr' ? `${d}.${m}.${y}` : `${m}/${d}/${y}`;
  }

  function detectCurrency(raw) {
    const text = String(raw || '').toLowerCase();
    const found = [];
    if (/₺|\btl\b|\btry\b|türk lira|turk lira|turkish lira/.test(text)) found.push('TRY');
    if (/\$|\busd\b|dollar|dolar/.test(text)) found.push('USD');
    if (/€|\beur\b|euro|avro/.test(text)) found.push('EUR');
    return found.length === 1 ? found[0] : null;
  }

  function detectPeriod(normalized) {
    const yearly = /\b(annual|annually|yearly|per year|per annum|year|yillik|yilda|senelik)\b/.test(normalized);
    const monthly = /\b(monthly|per month|month|aylik|ayda)\b/.test(normalized);
    if (yearly && !monthly) return 'yearly';
    if (monthly && !yearly) return 'monthly';
    return null;
  }

  function salaryAmounts(ctx) {
    return {
      TRY: parseNumber(pick(ctx, 'career.salaryTRY')),
      USD: parseNumber(pick(ctx, 'career.salaryUSD')),
      EUR: parseNumber(pick(ctx, 'career.salaryEUR'))
    };
  }

  function chooseCurrency(ctx, amounts, explicit) {
    if (explicit) return amounts[explicit] > 0 ? explicit : null;
    const order = [pick(ctx, 'career.preferredCurrency'), ctx.lang === 'tr' ? 'TRY' : 'USD', 'TRY', 'USD', 'EUR'];
    return order.find((code) => code && amounts[code] > 0) || null;
  }

  function resolveSalary(ctx) {
    const amounts = salaryAmounts(ctx);
    const currency = chooseCurrency(ctx, amounts, detectCurrency(ctx.desc.raw));
    if (!currency) return null;

    let amount = amounts[currency];
    const storedPeriod = pick(ctx, 'career.salaryPeriod') || 'monthly';
    const fieldPeriod = detectPeriod(`${ctx.desc.label} ${ctx.desc.placeholder} ${ctx.desc.context}`);
    if (fieldPeriod && fieldPeriod !== storedPeriod) {
      amount = fieldPeriod === 'yearly' ? amount * 12 : amount / 12;
    }
    amount = Math.round(amount);
    return { text: String(amount), numeric: amount, currency };
  }

  function resolveSalaryCurrency(ctx) {
    const currency = chooseCurrency(ctx, salaryAmounts(ctx), null) || pick(ctx, 'career.preferredCurrency');
    if (!currency) return null;
    return { text: currency, candidates: CURRENCY_ALIASES[currency] || [currency] };
  }

  function resolvePhone(ctx) {
    const phone = pick(ctx, 'personal.phone');
    if (!phone) return null;
    const max = ctx.unit.el.maxLength;
    if (max > 0 && phone.length > max) {
      const digits = phone.replace(/\D/g, '');
      return { text: digits.slice(-Math.min(max, digits.length)) };
    }
    return { text: phone };
  }

  function resolveBirthDate(ctx) {
    const iso = pick(ctx, 'personal.birthDate');
    if (!iso) return null;
    return { date: iso, text: formatDate(iso, ctx.desc.raw, ctx.lang) };
  }

  function resolveCountry(ctx) {
    const country = pick(ctx, 'personal.country');
    if (!country) return null;
    const normalized = normalize(country);
    const aliases = COUNTRY_ALIASES.find((group) => group.some((alias) => normalize(alias) === normalized)) || [];
    return { text: country, candidates: [country, ...aliases] };
  }

  function resolveLocation(ctx) {
    const parts = [pick(ctx, 'personal.city'), pick(ctx, 'personal.country')].filter(Boolean);
    return parts.length ? { text: parts.join(', ') } : null;
  }

  function resolveYears(ctx) {
    const raw = pick(ctx, 'career.yearsOfExperience');
    const years = parseNumber(raw);
    if (!Number.isFinite(years)) return null;
    return {
      text: String(years),
      numeric: years,
      candidates: [`${years} years`, `${years} year`, `${years} yıl`, `${years}+`]
    };
  }

  function getPreferredWorkModes(ctx) {
    const raw = ctx.profile && ctx.profile.career && ctx.profile.career.workModes;
    const list = Array.isArray(raw) ? raw.slice() : [];
    const legacy = pick(ctx, 'career.workMode');
    if (!list.length && legacy) list.push(legacy);
    return unique(list.filter((mode) => WORK_MODES[mode]));
  }

  function modeChoice(mode, lang) {
    const definition = WORK_MODES[mode];
    return {
      text: definition[lang] || definition.en,
      candidates: [definition.en, definition.tr, ...definition.synonyms]
    };
  }

  function resolveWorkMode(ctx) {
    const modes = getPreferredWorkModes(ctx);
    if (!modes.length) return null;

    const rankedChoices = modes.map((mode) => modeChoice(mode, ctx.lang));
    const question = `${ctx.desc.label} ${ctx.desc.placeholder} ${ctx.desc.context}`;
    const mentioned = Object.keys(WORK_MODES).filter((key) => WORK_MODES[key].detect.test(question));
    let bool;
    if (mentioned.length) bool = mentioned.some((key) => modes.includes(key));

    return {
      text: rankedChoices.map((choice) => choice.text).join(', '),
      candidates: rankedChoices[0].candidates,
      bool,
      multi: modes,
      rankedChoices
    };
  }

  function resolveResumeFile(ctx) {
    const documents = ctx.documents || {};
    const primary = documents[ctx.lang];
    const fallback = ctx.settings.fallbackToOtherLanguage
      ? documents[ctx.lang === 'tr' ? 'en' : 'tr']
      : null;
    const doc = primary && primary.bytes ? primary : (fallback && fallback.bytes ? fallback : null);
    if (!doc) return null;
    return { file: doc };
  }

  function resolveNotice(ctx) {
    const unit = pick(ctx, 'career.noticeUnit');
    const amount = parseInt(pick(ctx, 'career.noticeAmount'), 10);
    if (!unit) return null;

    const immediate = unit === 'immediate' || amount === 0;
    if (!immediate && !(amount > 0 && NOTICE_UNITS[unit])) return null;
    const days = immediate ? 0 : amount * NOTICE_UNITS[unit].factor;

    const type = ctx.unit.el.type;
    if (type === 'date') {
      const start = new Date();
      start.setDate(start.getDate() + days);
      return { date: isoDate(start), text: isoDate(start) };
    }

    if (immediate) {
      return {
        text: ctx.lang === 'tr' ? 'Hemen başlayabilirim' : 'Immediately',
        candidates: ['immediately', 'immediate', 'hemen', 'asap', 'derhal', 'none', 'yok', '0'],
        numeric: 0
      };
    }

    const def = NOTICE_UNITS[unit];
    const enUnit = amount === 1 ? def.en[0] : def.en[1];
    return {
      text: ctx.lang === 'tr' ? `${amount} ${def.tr}` : `${amount} ${enUnit}`,
      candidates: [`${amount} ${enUnit}`, `${amount} ${def.tr}`, `${amount} ${def.en[0]}`, `${days} days`, `${days} gün`]
    };
  }

  function resolveMilitary(ctx) {
    const status = MILITARY_STATUSES[pick(ctx, 'career.militaryStatus')];
    if (!status) return null;
    return { text: status[ctx.lang] || status.en, candidates: [status.tr, status.en, ...status.synonyms] };
  }

  function resolveEnglishLevel(ctx) {
    const level = ENGLISH_LEVELS[pick(ctx, 'career.englishLevel')];
    if (!level) return null;
    return { text: level[ctx.lang] || level.en, candidates: [level.tr, level.en, ...level.synonyms] };
  }

  function resolveWorkAuthorization(ctx) {
    const auth = WORK_AUTHORIZATIONS[pick(ctx, 'career.workAuthorization')];
    if (!auth) return null;
    const details = pick(ctx, 'career.visaDetails');
    const base = auth[ctx.lang] || auth.en;
    return {
      text: details ? `${base} (${details})` : base,
      candidates: [auth.tr, auth.en, ...auth.synonyms],
      bool: auth.authorized
    };
  }

  const RESOLVERS = {
    firstName: (ctx) => textValue(pick(ctx, 'personal.firstName')),
    lastName: (ctx) => textValue(pick(ctx, 'personal.lastName')),
    fullName: (ctx) => textValue([pick(ctx, 'personal.firstName'), pick(ctx, 'personal.lastName')].filter(Boolean).join(' ')),
    email: (ctx) => textValue(pick(ctx, 'personal.email')),
    phone: resolvePhone,
    birthDate: resolveBirthDate,
    postalCode: (ctx) => textValue(pick(ctx, 'personal.postalCode')),
    address: (ctx) => textValue(pick(ctx, 'personal.address')),
    city: (ctx) => {
      const city = pick(ctx, 'personal.city');
      return city ? { text: city, candidates: [city] } : null;
    },
    country: resolveCountry,
    location: resolveLocation,
    linkedin: (ctx) => textValue(pick(ctx, 'links.linkedin')),
    github: (ctx) => textValue(pick(ctx, 'links.github')),
    kaggle: (ctx) => textValue(pick(ctx, 'links.kaggle')),
    twitter: (ctx) => textValue(pick(ctx, 'links.twitter')),
    medium: (ctx) => textValue(pick(ctx, 'links.medium')),
    portfolio: (ctx) => textValue(pick(ctx, 'links.portfolio') || pick(ctx, 'links.website')),
    website: (ctx) => textValue(pick(ctx, 'links.website') || pick(ctx, 'links.portfolio')),
    currentTitle: (ctx) => textValue(pick(ctx, 'career.currentTitle')),
    currentCompany: (ctx) => textValue(pick(ctx, 'career.currentCompany')),
    yearsOfExperience: resolveYears,
    salary: resolveSalary,
    salaryCurrency: resolveSalaryCurrency,
    workMode: resolveWorkMode,
    noticePeriod: resolveNotice,
    militaryStatus: resolveMilitary,
    englishLevel: resolveEnglishLevel,
    workAuthorization: resolveWorkAuthorization,
    requiresSponsorship: (ctx) => yesNoValue(pick(ctx, 'career.requiresSponsorship'), ctx.lang),
    willingToRelocate: (ctx) => yesNoValue(pick(ctx, 'career.willingToRelocate'), ctx.lang),
    coverLetter: (ctx) => textValue(langText(ctx, 'coverLetter')),
    summary: (ctx) => textValue(langText(ctx, 'summary')),
    experience: (ctx) => textValue(langText(ctx, 'experience')),
    education: (ctx) => textValue(langText(ctx, 'education')),
    resumeFile: resolveResumeFile
  };

  function isEmptyValue(value) {
    if (!value) return true;
    return !value.text && !value.file && typeof value.bool !== 'boolean' && !(value.candidates && value.candidates.length) && !(value.rankedChoices && value.rankedChoices.length);
  }

  /* ------------------------------------------------------------------ */
  /* Option matching (select / radio / checkbox groups)                  */
  /* ------------------------------------------------------------------ */

  const PLACEHOLDER_OPTION = /^(select|choose|please|pick|seciniz|secin|sec|lutfen|none selected|bir secim)/;

  function isPlaceholderOption(option, index) {
    const text = normalize(option.textContent);
    if (option.value === '') return true;
    return index === 0 && (!text || PLACEHOLDER_OPTION.test(text));
  }

  function selectOptions(select) {
    return Array.from(select.options)
      .map((option, index) => ({ option, index }))
      .filter(({ option, index }) => !option.disabled && !isPlaceholderOption(option, index))
      .map(({ option }) => buildOption(option, option.textContent.trim(), option.value));
  }

  function matchesWord(option, words) {
    return words.some((word) =>
      option.norm === word || option.normValue === word || (word.length > 1 && option.norm.startsWith(`${word} `))
    );
  }

  function looksLikeYesNo(options) {
    return options.some((o) => matchesWord(o, YES_WORDS)) && options.some((o) => matchesWord(o, NO_WORDS));
  }

  function numberRange(text) {
    const norm = String(text).toLowerCase();
    const numbers = (norm.match(/\d+(?:[.,]\d+)*\s*k?/g) || []).map(parseNumber).filter(Number.isFinite);
    if (!numbers.length) return null;
    if (numbers.length >= 2) return [Math.min(numbers[0], numbers[1]), Math.max(numbers[0], numbers[1])];
    const n = numbers[0];
    if (/\+|or more|and above|over|more than|plus|ve uzeri|ve üzeri|üzeri|uzeri|fazla/.test(norm)) return [n, Infinity];
    if (/less than|under|below|fewer|<|alt[ıi]|az\b|kadar/.test(norm)) return [-Infinity, n];
    return [n, n];
  }

  function matchNumericOption(options, value) {
    let exact = null;
    let ranged = null;
    for (const option of options) {
      const range = numberRange(option.text);
      if (!range) continue;
      if (range[0] === range[1] && range[0] === value) exact = exact || option;
      else if (value >= range[0] && value <= range[1]) ranged = ranged || option;
    }
    return exact || ranged;
  }

  function pickChoice(options, value) {
    if (!options.length) return null;

    if (typeof value.bool === 'boolean' && looksLikeYesNo(options)) {
      return options.find((o) => matchesWord(o, value.bool ? YES_WORDS : NO_WORDS)) || null;
    }

    const candidates = unique([value.text, ...(value.candidates || [])].map(normalize).filter(Boolean));

    for (const candidate of candidates) {
      const option = options.find((o) => o.norm === candidate || o.normValue === candidate);
      if (option) return option;
    }

    if (typeof value.numeric === 'number' && Number.isFinite(value.numeric)) {
      const option = matchNumericOption(options, value.numeric);
      if (option) return option;
    }

    for (const candidate of candidates) {
      if (candidate.length < 2) continue;
      const option = options.find((o) =>
        o.norm.startsWith(`${candidate} `) || (o.norm.length >= 3 && candidate.startsWith(`${o.norm} `))
      );
      if (option) return option;
    }

    for (const candidate of candidates) {
      if (candidate.length < 3) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(candidate)}\\b`);
      const option = options.find((o) => pattern.test(o.norm) || pattern.test(o.normValue));
      if (option) return option;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Framework-friendly value setters                                    */
  /* ------------------------------------------------------------------ */

  function fire(el, type, data) {
    let event = null;
    if (type === 'input' && typeof InputEvent === 'function') {
      try {
        event = new InputEvent('input', { bubbles: true, cancelable: false, composed: true, inputType: 'insertText', data: data ?? null });
      } catch (_) {
        event = null;
      }
    }
    if (!event && (type === 'blur' || type === 'focus' || type === 'focusin' || type === 'focusout') && typeof FocusEvent === 'function') {
      event = new FocusEvent(type, { bubbles: true, composed: true });
    }
    if (!event) event = new Event(type, { bubbles: true, cancelable: type !== 'input', composed: true });
    el.dispatchEvent(event);
  }

  function focusSafely(el) {
    try {
      el.focus({ preventScroll: true });
    } catch (_) { /* not focusable */ }
  }

  function finishInteraction(el) {
    if (!askPage(el, 'blur')) {
      fire(el, 'change');
      fire(el, 'blur');
      fire(el, 'focusout');
    }
  }

  // The page bridge (installed in the page's own JS world) reads these attributes
  // during the event and writes the value there, so React/Vue trackers update.
  function askPage(el, kind, value) {
    if (!el || typeof el.setAttribute !== 'function') return false;
    try {
      el.setAttribute('data-applypilot-kind', kind);
      if (value !== undefined && value !== null) el.setAttribute('data-applypilot-value', String(value));
      else el.removeAttribute('data-applypilot-value');
      el.dispatchEvent(new Event('applypilot-commit', { bubbles: true, composed: true }));
    } catch (_) {
      return false;
    }
    const committed = el.getAttribute('data-applypilot-committed') === '1';
    el.removeAttribute('data-applypilot-committed');
    el.removeAttribute('data-applypilot-kind');
    el.removeAttribute('data-applypilot-value');
    return committed;
  }

  // Calling the prototype setter bypasses the instance-level setter React installs,
  // so React's value tracker sees a real change and onChange fires.
  function setNativeValue(el, value) {
    const tag = String(el.tagName).toUpperCase();
    const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : tag === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function setTextValue(el, text, options) {
    if (!text) return 'nodata';
    const keepFocus = Boolean(options && options.keepFocus);
    const tag = String(el.tagName || '').toUpperCase();
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return setEditableValue(el, text, options);
    focusSafely(el);
    if (el.readOnly && el.getAttribute('aria-haspopup') !== 'listbox' && el.getAttribute('role') !== 'combobox') {
      try { el.readOnly = false; } catch (_) { /* leave it locked */ }
    }
    const committed = askPage(el, keepFocus ? 'type' : 'text', text);
    if (!committed) {
      setNativeValue(el, text);
      fire(el, 'input', text);
      if (!keepFocus) fire(el, 'change');
    }
    if (!keepFocus) finishInteraction(el);
    return String(el.value || '').trim() ? 'filled' : 'failed';
  }

  function setEditableValue(el, text, options) {
    if (!text) return 'nodata';
    const keepFocus = Boolean(options && options.keepFocus);
    focusSafely(el);
    const committed = askPage(el, keepFocus ? 'type' : 'editable', text);
    if (!committed) {
      const doc = el.ownerDocument || document;
      let inserted = false;
      try {
        const selection = doc.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        inserted = doc.execCommand('insertText', false, text);
      } catch (_) {
        inserted = false;
      }
      if (!inserted || !String(el.textContent || '').trim()) {
        el.textContent = text;
        fire(el, 'input', text);
      }
    }
    if (!keepFocus) finishInteraction(el);
    return String(el.textContent || '').trim() ? 'filled' : 'failed';
  }

  function setSelectValue(select, option) {
    focusSafely(select);
    const committed = askPage(select, 'select', option.value);
    if (!committed) {
      option.el.selected = true;
      setNativeValue(select, option.value);
      fire(select, 'input', null);
      fire(select, 'change');
    }
    finishInteraction(select);
    return select.value === option.value ? 'filled' : 'failed';
  }

  function isChecked(input) {
    return Boolean(input.checked) || input.getAttribute('aria-checked') === 'true';
  }

  function checkInput(input) {
    if (isChecked(input)) return 'filled';
    const committed = askPage(input, 'check');
    if (!committed) {
      try { input.click(); } catch (_) { /* custom widget */ }
    }
    if (!isChecked(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      if (descriptor && descriptor.set) descriptor.set.call(input, true);
      else input.checked = true;
      if (input.getAttribute('role') === 'radio' || input.getAttribute('role') === 'checkbox') {
        input.setAttribute('aria-checked', 'true');
      }
      fire(input, 'input', null);
      fire(input, 'change');
    }
    if (!askPage(input, 'blur')) {
      fire(input, 'blur');
      fire(input, 'focusout');
    }
    return isChecked(input) ? 'filled' : 'failed';
  }

  function formatForInput(el, value) {
    const type = String(el.type || 'text').toLowerCase();
    let text = value.text === undefined || value.text === null ? '' : String(value.text);

    if (type === 'number') {
      const number = typeof value.numeric === 'number' ? value.numeric : parseNumber(text);
      return Number.isFinite(number) ? String(number) : '';
    }
    if (type === 'date') {
      const iso = value.date || text;
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
    }
    if (type === 'month') {
      const iso = value.date || text;
      return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : '';
    }
    if (el.maxLength > 0) text = truncate(text, el.maxLength);
    return text;
  }

  function pickFromRanked(options, value) {
    if (Array.isArray(value.rankedChoices)) {
      for (const choice of value.rankedChoices) {
        const option = pickChoice(options, choice);
        if (option) return option;
      }
    }
    return pickChoice(options, value);
  }

  function acceptAllowsFile(accept, name, type) {
    if (!accept) return true;
    const tokens = accept.toLowerCase().split(',').map((token) => token.trim()).filter(Boolean);
    if (!tokens.length) return true;
    const lowerName = String(name || '').toLowerCase();
    const lowerType = String(type || '').toLowerCase();
    const ext = lowerName.includes('.') ? `.${lowerName.split('.').pop()}` : '';
    if (tokens.some((token) => token === 'image/*' || token.startsWith('image/'))) {
      const hasDocument = tokens.some((token) =>
        token === '.pdf' || token.includes('pdf') || token.includes('msword') || token.includes('officedocument') || token === '.doc' || token === '.docx'
      );
      if (!hasDocument) return false;
    }
    return tokens.some((token) => {
      if (token === '*/*' || token === 'application/*') return true;
      if (token.startsWith('.') && ext === token) return true;
      if (token.endsWith('/*') && lowerType.startsWith(token.slice(0, -1))) return true;
      return token === lowerType || (token.includes('pdf') && (lowerType.includes('pdf') || ext === '.pdf'));
    });
  }

  function setFileValue(el, doc) {
    if (!doc || !doc.bytes) return 'nodata';
    const name = doc.name || 'cv.pdf';
    const type = doc.type || 'application/pdf';
    if (!acceptAllowsFile(el.accept, name, type)) return 'nomatch';
    if (typeof DataTransfer !== 'function' || typeof File !== 'function') return 'failed';

    let bytes = doc.bytes;
    if (!(bytes instanceof ArrayBuffer) && ArrayBuffer.isView(bytes)) {
      bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    if (!(bytes instanceof ArrayBuffer)) return 'failed';

    const file = new File([bytes], name, { type, lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    focusSafely(el);
    try {
      el.files = transfer.files;
    } catch (_) {
      return 'failed';
    }
    if (!askPage(el, 'change')) {
      fire(el, 'input', null);
      fire(el, 'change');
    }
    finishInteraction(el);
    return el.files && el.files.length ? 'filled' : 'failed';
  }

  function findOpenListbox(el) {
    const controls = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (controls) {
      const list = byId(el, controls.split(/\s+/)[0]);
      if (list) return list;
    }
    const lists = queryDeep('[role="listbox"], [role="menu"]');
    return lists.find((list) => list.getAttribute('aria-hidden') !== 'true' && !isEffectivelyHidden(list)) || null;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function applyCombobox(unit, value) {
    const el = unit.el;
    focusSafely(el);
    if (!askPage(el, 'click')) {
      try { el.click(); } catch (_) { /* not clickable */ }
    }

    const input = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : el.querySelector('input, textarea');
    const text = value.text || (value.candidates && value.candidates[0]) || '';
    if (input && text) setTextValue(input, formatForInput(input, value), { keepFocus: true });
    else if (text && (el.isContentEditable || el.getAttribute('role') === 'textbox')) setEditableValue(el, text, { keepFocus: true });

    let option = null;
    for (let attempt = 0; attempt < 6 && !option; attempt += 1) {
      const list = findOpenListbox(el);
      if (list) {
        const options = Array.from(list.querySelectorAll('[role="option"], [role="menuitem"], li')).map((item) =>
          buildOption(item, textOf(item, 120) || item.textContent || '', item.getAttribute('data-value') || item.textContent || '')
        );
        option = pickFromRanked(options, value);
        if (option) break;
      }
      await delay(80);
    }

    if (option) {
      if (!askPage(option.el, 'click')) {
        try { option.el.click(); } catch (_) { /* ignore */ }
      }
      finishInteraction(el);
      return 'filled';
    }

    try {
      (input || el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
    } catch (_) { /* ignore */ }

    if (input && String(input.value || '').trim()) return 'filled';
    if (el.textContent && String(el.textContent).trim() && !/select|seçiniz|seciniz|choose/i.test(el.textContent)) return 'filled';
    return text ? 'filled' : 'nomatch';
  }

  async function applyValue(unit, value) {
    switch (unit.kind) {
      case 'input':
      case 'textarea':
        return setTextValue(unit.el, formatForInput(unit.el, value));
      case 'combobox':
        return applyCombobox(unit, value);
      case 'editable':
        return setEditableValue(unit.el, value.text);
      case 'file':
        return setFileValue(unit.el, value.file);
      case 'select': {
        if (unit.el.multiple && Array.isArray(value.rankedChoices)) {
          let any = false;
          for (const choice of value.rankedChoices) {
            const option = pickChoice(selectOptions(unit.el), choice);
            if (option) {
              option.el.selected = true;
              any = true;
            }
          }
          if (any) {
            if (!askPage(unit.el, 'change')) {
              fire(unit.el, 'input', null);
              fire(unit.el, 'change');
            }
            finishInteraction(unit.el);
            return 'filled';
          }
        }
        const option = pickFromRanked(selectOptions(unit.el), value);
        return option ? setSelectValue(unit.el, option) : 'nomatch';
      }
      case 'radio': {
        const option = pickFromRanked(unit.options, value);
        return option ? checkInput(option.el) : 'nomatch';
      }
      case 'checkbox':
        return value.bool === true ? checkInput(unit.el) : 'nomatch';
      case 'checkboxGroup': {
        if (Array.isArray(value.rankedChoices) && value.rankedChoices.length) {
          let filled = 0;
          for (const choice of value.rankedChoices) {
            const option = pickChoice(unit.options, choice);
            if (option && checkInput(option.el) === 'filled') filled += 1;
          }
          if (filled) return 'filled';
        }
        const option = pickChoice(unit.options, { ...value, bool: undefined });
        return option ? checkInput(option.el) : 'nomatch';
      }
      default:
        return 'nomatch';
    }
  }

  function hasValue(unit) {
    const el = unit.el;
    switch (unit.kind) {
      case 'input':
      case 'textarea':
      case 'combobox': {
        const input = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : el.querySelector('input, textarea');
        const current = String((input && input.value) || el.textContent || '').trim();
        return current !== '' && !/^(https?:\/\/(www\.)?|\+\d{0,3}|0|select|select one|seçiniz|choose)$/i.test(current);
      }
      case 'editable':
        return String(el.textContent || '').trim() !== '';
      case 'select': {
        const index = el.selectedIndex;
        if (index < 0) return false;
        const option = el.options[index];
        if (isPlaceholderOption(option, index)) return false;
        return !(index === 0 && !option.defaultSelected);
      }
      case 'checkbox':
        return el.checked;
      case 'radio':
      case 'checkboxGroup':
        return unit.elements.some((input) => input.checked);
      case 'file':
        return Boolean(el.files && el.files.length);
      default:
        return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Visual feedback                                                     */
  /* ------------------------------------------------------------------ */

  function highlight(unit) {
    let target = unit.highlightTarget || unit.el;
    if (!isVisible(target)) target = (unit.el && unit.el.closest && unit.el.closest('label')) || (unit.el && unit.el.parentElement) || target;
    if (!target || !target.style) return;

    const style = target.style;
    const previous = {
      outline: [style.getPropertyValue('outline'), style.getPropertyPriority('outline')],
      outlineOffset: [style.getPropertyValue('outline-offset'), style.getPropertyPriority('outline-offset')],
      boxShadow: [style.getPropertyValue('box-shadow'), style.getPropertyPriority('box-shadow')],
      transition: [style.getPropertyValue('transition'), style.getPropertyPriority('transition')]
    };

    style.setProperty('transition', 'outline-color 0.4s ease, box-shadow 0.4s ease', 'important');
    style.setProperty('outline', '2px solid #22c55e', 'important');
    style.setProperty('outline-offset', '2px', 'important');
    style.setProperty('box-shadow', '0 0 0 4px rgba(34, 197, 94, 0.22)', 'important');
    target.setAttribute('data-applypilot-filled', 'true');

    setTimeout(() => {
      const restore = (prop, [value, priority]) => {
        if (value) style.setProperty(prop, value, priority);
        else style.removeProperty(prop);
      };
      restore('outline', previous.outline);
      restore('outline-offset', previous.outlineOffset);
      restore('box-shadow', previous.boxShadow);
      restore('transition', previous.transition);
      target.removeAttribute('data-applypilot-filled');
    }, 4000);
  }

  function showToast(message, variant) {
    if (window.top !== window || !document.documentElement) return { ok: false, error: 'NOT_TOP_FRAME' };

    const HOST_ID = 'applypilot-toast-host';
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('right', '20px', 'important');
    host.style.setProperty('bottom', '20px', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .toast { display: flex; align-items: center; gap: 12px; min-width: 240px; max-width: 360px; padding: 12px 16px;
        border-radius: 12px; background: #111827; color: #f9fafb; box-shadow: 0 12px 32px rgba(0,0,0,.28);
        font: 500 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; opacity: 0; transform: translateY(12px);
        transition: opacity .25s ease, transform .25s ease; }
      .toast.show { opacity: 1; transform: translateY(0); }
      .badge { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
        background: linear-gradient(135deg, #4f46e5, #7c3aed); font-size: 15px; }
      .toast.success .badge { background: linear-gradient(135deg, #16a34a, #22c55e); }
      .title { display: block; font-weight: 700; font-size: 12px; letter-spacing: .02em; opacity: .75; }
      .message { margin: 0; }
    `;

    const toast = document.createElement('div');
    toast.className = `toast ${variant === 'success' ? 'success' : 'info'}`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = variant === 'success' ? '✓' : '✈';
    const body = document.createElement('div');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = 'ApplyPilot';
    const text = document.createElement('p');
    text.className = 'message';
    text.textContent = String(message || '');
    body.append(title, text);
    toast.append(badge, body);
    shadow.append(style, toast);

    (document.body || document.documentElement).appendChild(host);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => host.remove(), 300);
    }, 4200);
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* Public actions                                                      */
  /* ------------------------------------------------------------------ */

  function resolveLanguage(requested, detection) {
    return requested === 'tr' || requested === 'en' ? requested : detection.lang;
  }

  function looksLikePendingForm() {
    if (!document.documentElement) return false;
    const box = document.documentElement.getBoundingClientRect();
    if (box.width < 48 || box.height < 48) return false;
    if (!document.body || document.readyState !== 'complete') return true;
    if (document.querySelector('[class*="application" i], [id*="application" i], [class*="basvuru" i], [id*="basvuru" i], [role="form"]')) return true;
    const text = String(document.body.innerText || '').replace(/\s+/g, ' ').trim();
    if (text.length < 40) return true;
    return /loading|please wait|yukleniyor|application form|basvuru formu/i.test(text.slice(0, 500));
  }

  async function collectUnitsWhenReady() {
    let units = collectUnits();
    if (units.length || !looksLikePendingForm()) return units;
    const started = Date.now();
    while (!units.length && Date.now() - started < 800) {
      await delay(150);
      units = collectUnits();
    }
    return units;
  }

  function scan(request) {
    const detection = detectLanguage();
    return collectUnitsWhenReady().then((units) => {
      const matches = matchUnits(units);
      return {
        ok: true,
        language: resolveLanguage(request && request.language, detection),
        detectedLanguage: detection.lang,
        total: units.length,
        matched: matches.length,
        fields: unique(matches.map((match) => match.rule.key))
      };
    });
  }

  async function fill(request) {
    const profile = (request && request.profile) || {};
    const settings = Object.assign(
      { categories: {}, overwriteExisting: false, highlightFields: true, fallbackToOtherLanguage: true },
      (request && request.settings) || {}
    );
    const detection = detectLanguage();
    const lang = resolveLanguage(request && request.language, detection);

    const units = await collectUnitsWhenReady();
    const matches = matchUnits(units);
    const result = {
      ok: true,
      language: lang,
      detectedLanguage: detection.lang,
      total: units.length,
      matched: matches.length,
      filled: 0,
      skipped: 0,
      empty: 0,
      failed: 0,
      fields: []
    };

    let touched = false;
    for (const match of matches) {
      if (settings.categories[match.rule.category] === false) {
        result.skipped += 1;
        continue;
      }
      if (!settings.overwriteExisting && hasValue(match.unit)) {
        result.skipped += 1;
        continue;
      }

      const ctx = { profile, settings, lang, unit: match.unit, desc: match.desc, documents: (request && request.documents) || {} };
      let value = null;
      try {
        value = RESOLVERS[match.rule.key](ctx);
      } catch (_) {
        value = null;
      }
      if (isEmptyValue(value)) {
        result.empty += 1;
        continue;
      }

      let status = 'failed';
      try {
        status = await applyValue(match.unit, value);
        touched = true;
      } catch (_) {
        status = 'failed';
      }

      if (status === 'filled') {
        result.filled += 1;
        result.fields.push(match.rule.key);
        if (settings.highlightFields) highlight(match.unit);
      } else if (status === 'nodata') {
        result.empty += 1;
      } else if (status === 'nomatch') {
        result.skipped += 1;
      } else {
        result.failed += 1;
      }
    }

    if (touched && document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    result.fields = unique(result.fields);
    return result;
  }

  function run(action, payload) {
    globalThis.__ApplyPilotWalkFrames = Boolean(payload && payload.walkFrames);
    switch (action) {
      case 'scan':
        return scan(payload);
      case 'fill':
        return fill(payload);
      case 'toast':
        return showToast(payload && payload.message, payload && payload.variant);
      case 'ping':
        return { ok: true, version: ENGINE_VERSION };
      default:
        return { ok: false, error: `UNKNOWN_ACTION:${action}` };
    }
  }

  const engine = Object.freeze({ version: ENGINE_VERSION, run, normalize, detectLanguage });
  globalThis.__ApplyPilotEngine = engine;
  try {
    window.__ApplyPilotEngine = engine;
  } catch (_) { /* sandboxed window */ }

  if (extensionAPI && extensionAPI.runtime && extensionAPI.runtime.onMessage && !globalThis.__ApplyPilotListener) {
    globalThis.__ApplyPilotListener = true;
    extensionAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.source !== 'applypilot') return undefined;
      try {
        const output = globalThis.__ApplyPilotEngine.run(message.action, message.payload);
        if (output && typeof output.then === 'function') {
          output.then(sendResponse, (error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
          return true;
        }
        sendResponse(output);
      } catch (error) {
        sendResponse({ ok: false, error: String((error && error.message) || error) });
      }
      return false;
    });
  }
})();
