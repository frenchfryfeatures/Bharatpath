const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing Tab Navigation and Career Assistant UI...');

// 1. Verify HomeScreen has no assistant button in header
const homeContent = fs.readFileSync(path.join(__dirname, '../screens/home/HomeScreen.tsx'), 'utf8');
assert(!homeContent.includes('CareerAssistantNavButton'), 'HomeScreen should not contain CareerAssistantNavButton');
assert(!homeContent.includes('CareerAssistantLauncher'), 'HomeScreen should not contain CareerAssistantLauncher');
console.log('✓ Top header in HomeScreen does not contain the chatbot button');

// 2. Verify JobsFeedScreen has no assistant button in header
const jobsContent = fs.readFileSync(path.join(__dirname, '../screens/jobs/JobsFeedScreen.tsx'), 'utf8');
assert(!jobsContent.includes('CareerAssistantNavButton'), 'JobsFeedScreen should not contain CareerAssistantNavButton');
assert(!jobsContent.includes('CareerAssistantLauncher'), 'JobsFeedScreen should not contain CareerAssistantLauncher');
console.log('✓ Top header in JobsFeedScreen does not contain the chatbot button');

// 3. Verify BottomTabBar has the center assistant button
const tabContent = fs.readFileSync(path.join(__dirname, '../components/navigation/BottomTabBar.tsx'), 'utf8');
assert(tabContent.includes('assistantCenterBtn'), 'BottomTabBar must have assistantCenterBtn style');
assert(tabContent.includes('CareerAssistantModal'), 'BottomTabBar must mount CareerAssistantModal');
assert(tabContent.includes('Sparkle size={24} color="#FFFFFF" weight="fill"'), 'BottomTabBar must render filled Sparkle icon');
console.log('✓ BottomTabBar has middle AI chatbot button with Sparkle icon and modal trigger');

// 4. Verify CareerAssistantModal typography matches website
const modalContent = fs.readFileSync(path.join(__dirname, '../components/assistant/CareerAssistantModal.tsx'), 'utf8');
assert(modalContent.includes("fontFamily: 'GeneralSans-Bold'"), 'Modal must use GeneralSans-Bold');
assert(modalContent.includes("fontFamily: 'GeneralSans-Medium'"), 'Modal must use GeneralSans-Medium');
assert(modalContent.includes("fontFamily: 'GeneralSans-Semibold'"), 'Modal must use GeneralSans-Semibold');
assert(modalContent.includes("fontFamily: 'GeneralSans-Regular'"), 'Modal must use GeneralSans-Regular');

// Brand title
assert(modalContent.includes("fontSize: 10"), 'Brand title must have 10px font size');
assert(modalContent.includes("color: '#8675AE'"), 'Brand title must match web color #8675AE');
// Header title
assert(modalContent.includes("fontSize: 17"), 'Header title must have 17px font size');
// Hero title
assert(modalContent.includes("fontSize: 23"), 'Hero title must have 23px font size');
// Bot bubble message
assert(modalContent.includes("color: '#26334B'"), 'Bot message text color must match web #26334B');
// Composer
assert(modalContent.includes("fontSize: 13"), 'Composer input font size must match web 13px');

console.log('✓ CareerAssistantModal typography and styles match web frontend (General Sans font family, sizes, weights)');

console.log('All Tab Navigation and Assistant UI tests passed successfully!');
