import unittest

from scripts.catalog_text import build_embedding_text, extract_brand


class CatalogTextTests(unittest.TestCase):
    def test_extract_brand_handles_known_multi_word_brands(self):
        self.assertEqual(extract_brand("Peter England Men Party Blue Jeans"), "Peter England")

    def test_extract_brand_handles_single_word_brands(self):
        self.assertEqual(extract_brand("Puma Men Grey T-shirt"), "Puma")
        self.assertEqual(extract_brand("Titan Women Silver Watch"), "Titan")
        self.assertEqual(extract_brand("Fabindia Men Striped Green Shirt"), "Fabindia")

    def test_extract_brand_uses_conservative_unknown_fallback(self):
        self.assertEqual(extract_brand("Turtle Check Men Navy Blue Shirt"), "Turtle")
        self.assertEqual(extract_brand("Navy Blue Men Casual Shirt"), "")

    def test_build_embedding_text_uses_rich_metadata_description(self):
        row = {
            "productDisplayName": "Turtle Check Men Navy Blue Shirt",
            "brand": "Turtle",
            "gender": "Men",
            "masterCategory": "Apparel",
            "subCategory": "Topwear",
            "articleType": "Shirts",
            "baseColour": "Navy Blue",
            "season": "Fall",
            "usage": "Casual",
        }

        text = build_embedding_text(row)

        self.assertIn("Turtle men's navy blue casual shirt", text)
        self.assertIn("Brand: Turtle.", text)
        self.assertIn("Category: Shirts.", text)
        self.assertIn("Subcategory: Topwear.", text)
        self.assertIn("Master category: Apparel.", text)
        self.assertIn("Color: Navy Blue.", text)
        self.assertIn("Season: Fall.", text)
        self.assertIn("Intended usage: Casual fashion.", text)


if __name__ == "__main__":
    unittest.main()
