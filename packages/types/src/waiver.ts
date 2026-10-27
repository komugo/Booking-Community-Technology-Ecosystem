export const WAIVER = {
  version: "2026-10-draft-1",
  en: `DRAFT – placeholder text pending legal review.

Release of liability for activities run by {operator}

1. I understand that horse riding, climbing and similar activities carry a risk of injury, including serious injury.
2. I confirm the Participant meets the stated age, weight and experience Requirements and has no medical condition that makes taking part unsafe.
3. The Participant will follow all safety briefings and instructions from {operator} staff, and wear the safety gear provided.
4. To the extent permitted by Malaysian law, I release {operator} and Komugo from claims for injury, loss or damage arising from ordinary risks of the activity, except where caused by negligence.
5. I consent to emergency first aid and medical treatment for the Participant if needed.
6. A parent or legal guardian signs for a Participant under 18.`,
  ms: `DRAF – teks sementara sementara menunggu semakan undang-undang.

Penepian liabiliti untuk aktiviti yang dikendalikan oleh {operator}

1. Saya faham bahawa menunggang kuda, memanjat dan aktiviti seumpamanya membawa risiko kecederaan, termasuk kecederaan serius.
2. Saya mengesahkan Peserta memenuhi syarat umur, berat dan pengalaman yang dinyatakan dan tiada keadaan perubatan yang menjadikan penyertaan tidak selamat.
3. Peserta akan mematuhi semua taklimat dan arahan keselamatan kakitangan {operator}, dan memakai peralatan keselamatan yang disediakan.
4. Setakat yang dibenarkan oleh undang-undang Malaysia, saya melepaskan {operator} dan Komugo daripada tuntutan kecederaan, kehilangan atau kerosakan akibat risiko biasa aktiviti, kecuali yang disebabkan oleh kecuaian.
5. Saya bersetuju dengan rawatan pertolongan cemas dan perubatan kecemasan untuk Peserta jika perlu.
6. Ibu bapa atau penjaga sah menandatangani untuk Peserta bawah 18 tahun.`,
};

export const waiverText = (locale: "en" | "ms", operator: string) => WAIVER[locale].replaceAll("{operator}", operator);
