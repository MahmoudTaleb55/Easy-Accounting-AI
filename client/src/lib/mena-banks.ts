// Bank-name suggestions per country, used to populate the "Bank name" datalist
// on the banking accounts form. These are proper nouns (institution names) and
// are intentionally not translated — a bank's registered name is the same label
// regardless of the UI language. Kept out of the component tree so the i18n
// completeness scan over components stays focused on translatable UI copy.
export const BANKS_BY_COUNTRY: Record<string, string[]> = {
  SA: ["مصرف الراجحي", "البنك الأهلي السعودي", "بنك الرياض", "البنك العربي الوطني", "بنك البلاد", "بنك الإنماء", "بنك الجزيرة"],
  AE: ["بنك أبوظبي الأول", "بنك الإمارات دبي الوطني", "بنك أبوظبي التجاري", "بنك دبي الإسلامي", "بنك المشرق"],
  KW: ["بنك الكويت الوطني", "بنك بوبيان", "بنك الخليج", "البنك الأهلي الكويتي", "بنك برقان"],
  QA: ["بنك قطر الوطني", "بنك قطر الإسلامي", "البنك التجاري", "بنك الدوحة"],
  EG: ["البنك الأهلي المصري", "بنك مصر", "البنك التجاري الدولي", "بنك القاهرة"],
  JO: ["البنك العربي", "بنك الأردن", "البنك الوطني الأردني", "بنك الإسكان"],
  INTL: ["HSBC", "JPMorgan Chase", "Citibank", "Deutsche Bank", "BNP Paribas", "Barclays", "Standard Chartered"],
};
