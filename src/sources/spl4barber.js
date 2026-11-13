// spl4barber.com.ua - official Wahl distributor (WordPress + WooCommerce, older "woodmart" theme). Ukrainian only.
// Same base columns as vroda; the shop's own characteristics as columns. Shared WooCommerce logic: ./lib/woocommerce.js. Notes about this site:
//  - Categories come from the "Категорії" list in the footer (WooCommerce's category widget): it has every
//    category, the top menu only some. Subcategories ("Запчастини для Wahl ...") are visited first.
//  - Page 1 of "Запчастини" shows only subcategory tiles; its products continue on page 2.
//  - No Russian version; all products are simple (no variations).
//  - In-stock products show no stock label (only the "add to cart" button); sold-out ones show
//    "Немає в наявності" and often no price.
//  - No attributes table (a few products list specs in the short description, as text); vendor is always Wahl.
//  - The description is the "Опис" tab; when a product has none, the short description next to the
//    price is used instead.
import { createWooSource } from './lib/woocommerce.js';

export default createWooSource({
  id: 'spl4barber',
  name: 'SPL4Barber',
  website: 'https://spl4barber.com.ua',
  description: 'Official Wahl distributor: clippers, trimmers, shavers, hair dryers, straighteners, spare parts and accessories.',
  menu: '.widget_product_categories ul.product-categories > li',
  brand: 'Wahl',
  descriptionFallback: '.single-product-page .woocommerce-product-details__short-description',
});
