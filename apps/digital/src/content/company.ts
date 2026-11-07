export const company = {
  name: "Komugo Digital",
  legalName: "",
  ssm: "",
  whatsapp: "",
  email: "",
  address: "",
  platformUrl: "https://komugo.com",
};

export const waLink = (text: string) => (company.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : "");
