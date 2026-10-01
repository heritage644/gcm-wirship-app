import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
} from "react-native";

const ORANGE = "#F09135";
const DARK = "#0D1017";
const WHITE = "#FFFFFF";
const MUTED = "#8E939D";
const LIGHT = "#F5F6F8";

const products = [
  {
    id: 1,
    name: "Classic Sneakers",
    price: "₦45,000",
    category: "Fashion",
    emoji: "👟",
  },
  {
    id: 2,
    name: "Premium Handbag",
    price: "₦38,500",
    category: "Fashion",
    emoji: "👜",
  },
  {
    id: 3,
    name: "Wireless Headphones",
    price: "₦62,000",
    category: "Electronics",
    emoji: "🎧",
  },
  {
    id: 4,
    name: "Smart Watch",
    price: "₦55,000",
    category: "Electronics",
    emoji: "⌚",
  },
];

const categories = [
  { name: "Fashion", icon: "👕" },
  { name: "Beauty", icon: "💄" },
  { name: "Food", icon: "🍔" },
  { name: "Electronics", icon: "📱" },
  { name: "Home", icon: "🏠" },
];

export default function FIle() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>
            se<Text style={styles.logoOrange}>ll</Text>onit
          </Text>

          <Text style={styles.headerSubtitle}>
            Your marketplace, your way.
          </Text>
        </View>

        <TouchableOpacity style={styles.profileButton}>
          <Text style={styles.profileText}>U</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* SEARCH */}
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>⌕</Text>

          <TextInput
            placeholder="Search products, stores..."
            placeholderTextColor="#999"
            style={styles.searchInput}
          />

          <TouchableOpacity style={styles.filterButton}>
            <Text style={styles.filterIcon}>☷</Text>
          </TouchableOpacity>
        </View>

        {/* HERO */}
        <View style={styles.hero}>
          <View style={styles.heroContent}>
            <Text style={styles.heroSmall}>SELLONIT</Text>

            <Text style={styles.heroTitle}>
              Discover products{"\n"}
              from local brands.
            </Text>

            <Text style={styles.heroDescription}>
              Shop from independent Nigerian businesses all in one place.
            </Text>

            <TouchableOpacity style={styles.heroButton}>
              <Text style={styles.heroButtonText}>Explore stores</Text>
              <Text style={styles.arrow}>→</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroCircle}>
            <Text style={styles.heroEmoji}>🛍️</Text>
          </View>
        </View>

        {/* SECTION HEADER */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Categories</Text>

          <TouchableOpacity>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>

        {/* CATEGORIES */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
        >
          {categories.map((category) => (
            <TouchableOpacity
              key={category.name}
              style={styles.categoryItem}
            >
              <View style={styles.categoryIcon}>
                <Text style={styles.categoryEmoji}>
                  {category.icon}
                </Text>
              </View>

              <Text style={styles.categoryName}>
                {category.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* FEATURED */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Featured products</Text>
            <Text style={styles.sectionSubtitle}>
              Products you might love
            </Text>
          </View>

          <TouchableOpacity>
            <Text style={styles.seeAll}>View all</Text>
          </TouchableOpacity>
        </View>

        {/* PRODUCTS */}
        <View style={styles.productGrid}>
          {products.map((product) => (
            <TouchableOpacity
              key={product.id}
              style={styles.productCard}
              activeOpacity={0.8}
            >
              <View style={styles.productImage}>
                <Text style={styles.productEmoji}>
                  {product.emoji}
                </Text>

                <View style={styles.favorite}>
                  <Text style={styles.favoriteText}>♡</Text>
                </View>
              </View>

              <View style={styles.productInfo}>
                <Text style={styles.productCategory}>
                  {product.category}
                </Text>

                <Text
                  style={styles.productName}
                  numberOfLines={1}
                >
                  {product.name}
                </Text>

                <Text style={styles.productPrice}>
                  {product.price}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* SELLER CTA */}
        <View style={styles.sellerCard}>
          <View style={styles.sellerTextContainer}>
            <Text style={styles.sellerSmall}>
              ARE YOU A BUSINESS OWNER?
            </Text>

            <Text style={styles.sellerTitle}>
              Start selling on Sellonit.
            </Text>

            <Text style={styles.sellerDescription}>
              Create your storefront and start reaching more customers.
            </Text>

            <TouchableOpacity style={styles.sellerButton}>
              <Text style={styles.sellerButtonText}>
                Create your store
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sellerEmoji}>🏪</Text>
        </View>

        {/* BOTTOM SPACE */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* BOTTOM NAVIGATION */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem}>
          <Text style={[styles.navIcon, styles.activeNavIcon]}>
            ⌂
          </Text>
          <Text style={[styles.navText, styles.activeNavText]}>
            Home
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIcon}>⌕</Text>
          <Text style={styles.navText}>Explore</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.addButton}>
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIcon}>♡</Text>
          <Text style={styles.navText}>Saved</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIcon}>☻</Text>
          <Text style={styles.navText}>Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LIGHT,
  },

  scrollContent: {
    paddingBottom: 20,
  },

  // ---------------- HEADER ----------------

  header: {
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  logo: {
    color: WHITE,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -1.5,
  },

  logoOrange: {
    color: ORANGE,
  },

  headerSubtitle: {
    color: "#8E939D",
    fontSize: 11,
    marginTop: 3,
  },

  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#252933",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#353944",
  },

  profileText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: "700",
  },

  // ---------------- SEARCH ----------------

  searchContainer: {
    marginHorizontal: 20,
    marginTop: -1,
    backgroundColor: WHITE,
    height: 54,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: "#E8E9EC",
  },

  searchIcon: {
    fontSize: 28,
    color: "#777",
    marginRight: 8,
  },

  searchInput: {
    flex: 1,
    fontSize: 14,
    color: DARK,
  },

  filterButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: DARK,
    alignItems: "center",
    justifyContent: "center",
  },

  filterIcon: {
    color: WHITE,
    fontSize: 20,
  },

  // ---------------- HERO ----------------

  hero: {
    marginHorizontal: 20,
    marginTop: 20,
    minHeight: 220,
    borderRadius: 24,
    backgroundColor: DARK,
    overflow: "hidden",
    padding: 24,
    flexDirection: "row",
  },

  heroContent: {
    flex: 1,
    zIndex: 2,
  },

  heroSmall: {
    color: ORANGE,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 10,
  },

  heroTitle: {
    color: WHITE,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.5,
  },

  heroDescription: {
    color: "#A9ADB5",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    maxWidth: 230,
  },

  heroButton: {
    marginTop: 17,
    backgroundColor: ORANGE,
    alignSelf: "flex-start",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },

  heroButtonText: {
    color: DARK,
    fontSize: 12,
    fontWeight: "800",
  },

  arrow: {
    color: DARK,
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "800",
  },

  heroCircle: {
    position: "absolute",
    right: -35,
    bottom: -35,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "#252933",
    alignItems: "center",
    justifyContent: "center",
  },

  heroEmoji: {
    fontSize: 65,
  },

  // ---------------- SECTIONS ----------------

  sectionHeader: {
    marginTop: 28,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sectionTitle: {
    color: DARK,
    fontSize: 18,
    fontWeight: "800",
  },

  sectionSubtitle: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },

  seeAll: {
    color: ORANGE,
    fontSize: 12,
    fontWeight: "700",
  },

  // ---------------- CATEGORIES ----------------

  categoryList: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  categoryItem: {
    alignItems: "center",
    marginRight: 18,
  },

  categoryIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: WHITE,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E8E9EC",
  },

  categoryEmoji: {
    fontSize: 25,
  },

  categoryName: {
    color: "#424650",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 7,
  },

  // ---------------- PRODUCTS ----------------

  productGrid: {
    paddingHorizontal: 20,
    paddingTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  productCard: {
    width: "48%",
    backgroundColor: WHITE,
    borderRadius: 17,
    overflow: "hidden",
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#E9EAED",
  },

  productImage: {
    height: 135,
    backgroundColor: "#F0F1F3",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  productEmoji: {
    fontSize: 55,
  },

  favorite: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor: WHITE,
    alignItems: "center",
    justifyContent: "center",
  },

  favoriteText: {
    color: DARK,
    fontSize: 19,
  },

  productInfo: {
    padding: 12,
  },

  productCategory: {
    color: ORANGE,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 4,
  },

  productName: {
    color: DARK,
    fontSize: 13,
    fontWeight: "700",
  },

  productPrice: {
    color: DARK,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 6,
  },

  // ---------------- SELLER CTA ----------------

  sellerCard: {
    marginHorizontal: 20,
    marginTop: 15,
    backgroundColor: ORANGE,
    borderRadius: 22,
    padding: 20,
    minHeight: 190,
    overflow: "hidden",
    flexDirection: "row",
  },

  sellerTextContainer: {
    flex: 1,
    zIndex: 2,
  },

  sellerSmall: {
    color: "#573510",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  sellerTitle: {
    color: DARK,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 8,
    maxWidth: 230,
  },

  sellerDescription: {
    color: "#553817",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
    maxWidth: 235,
  },

  sellerButton: {
    alignSelf: "flex-start",
    marginTop: 15,
    backgroundColor: DARK,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9,
  },

  sellerButtonText: {
    color: WHITE,
    fontSize: 11,
    fontWeight: "800",
  },

  sellerEmoji: {
    position: "absolute",
    right: -10,
    bottom: -10,
    fontSize: 75,
    opacity: 0.25,
  },

  // ---------------- BOTTOM NAV ----------------

  bottomNav: {
    height: 72,
    backgroundColor: WHITE,
    borderTopWidth: 1,
    borderTopColor: "#E6E7EA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8,
  },

  navItem: {
    width: 55,
    alignItems: "center",
    justifyContent: "center",
  },

  navIcon: {
    color: "#9A9EA6",
    fontSize: 21,
  },

  activeNavIcon: {
    color: ORANGE,
  },

  navText: {
    color: "#9A9EA6",
    fontSize: 9,
    fontWeight: "600",
    marginTop: 3,
  },

  activeNavText: {
    color: ORANGE,
  },

  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22,
    borderWidth: 4,
    borderColor: LIGHT,
  },

  addButtonText: {
    color: DARK,
    fontSize: 28,
    fontWeight: "400",
    marginTop: -2,
  },
});
