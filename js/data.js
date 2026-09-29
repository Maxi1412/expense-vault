const PAYMENTS_DEFAULT = ['Cash', 'Card', 'Debit Card', 'Credit Card', 'Bank Transfer', 'Direct Debit', 'Other'];
const CATS_DEFAULT = [
  ['Groceries','🛒','#2e9e6b'],['Dining','🍽️','#e8743b'],['Takeaway','🥡','#d9a520'],['Housing','🏠','#5b6ee1'],
  ['Utilities','💡','#e0b400'],['Internet & Phone','📶','#3aa0d8'],['Transport','🚌','#7a5bd6'],['Fuel','⛽','#c95151'],
  ['Vehicle','🚗','#6b7b8c'],['Clothing','👕','#d95b9a'],['Shopping','🛍️','#b04fc4'],['Medical','🩺','#e0525e'],
  ['Pharmacy','💊','#2bb5a0'],['Dental','🦷','#4fb3e8'],['Pets','🐾','#a8763e'],['Insurance','🛡️','#3f6fb5'],
  ['Entertainment','🎬','#e05a7a'],['Travel','✈️','#2a9fbf'],['Subscriptions','🔁','#8a6fe0'],['Household','🧽','#7fa33a'],
  ['Personal Care','🧴','#e28aa0'],['Gifts','🎁','#e0703a'],['Education','📚','#4a7fd0'],['Other','📦','#8b8f98']
].map(([name, icon, color]) => ({ id: name, name, icon, color, custom: false }));


const INCOME_CATS_DEFAULT = [
  ['Salary','💼','#1f9d63'],['Tips','💶','#35a86f'],['Private Work','🛠️','#3a8ec7'],
  ['Refund','↩️','#8a6fe0'],['Gift / Support','🎁','#d58b3a'],['Other Income','＋','#6b7b8c']
].map(([name, icon, color]) => ({ id: name, name, icon, color, custom: false }));

const BUDGETS_DEFAULT = [];

const PROFILE_DEFAULT = { name: '', currency: 'EUR', language: 'English', dateFormat: 'DD/MM/YYYY' };
const SETTINGS_DEFAULT = { theme: 'system', monthlyBudget: 0, ocrLanguages: 'eng+spa+deu' };
