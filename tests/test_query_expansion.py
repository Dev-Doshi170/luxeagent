import unittest

from backend.query_expansion import expand_query, tokenize


class QueryExpansionTests(unittest.TestCase):
    def test_expand_query_adds_conservative_fashion_synonyms(self):
        expanded = expand_query("luxury handbag")

        self.assertIn("luxury handbag", expanded)
        self.assertIn("designer", expanded)
        self.assertIn("premium", expanded)
        self.assertIn("leather handbag", expanded)
        self.assertIn("purse", expanded)

    def test_expand_query_deduplicates_terms_and_caps_drift(self):
        expanded = expand_query("formal watch premium watch", max_added_terms=4)

        self.assertEqual(expanded.count("watch"), 2)
        self.assertIn("office", expanded)
        self.assertIn("business", expanded)

    def test_tokenize_normalizes_punctuation_and_case(self):
        self.assertEqual(
            tokenize("Premium Navy-Blue Men's T-Shirt!"),
            ["premium", "navy", "blue", "men", "s", "t", "shirt"],
        )


if __name__ == "__main__":
    unittest.main()
