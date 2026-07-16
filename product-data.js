export const SITE_URL = "https://kezmodifications.com";

export const DEFAULT_PRODUCTS = [
    {
        id: "nhp-explorer",
        name: "Nevada Highway Patrol – 2020 Ford Explorer",
        category: "ready-for-road",
        price: 15,
        tag: "Ready For Road",
        desc: "Fully detailed NHP livery package with authentic patrol markings and realistic lighting.",
        images: [
            "/images/nhp/1.png",
            "/images/nhp/2.png",
            "/images/nhp/3.png",
            "/images/nhp/4.png",
            "/images/nhp/5.png",
            "/images/nhp/6.png",
        ],
    },
    {
        id: "bab-durango",
        name: "Unmarked B&B Dodge Durango",
        category: "ready-for-road",
        price: 10,
        tag: "Ready For Road",
        desc: "Low-profile unmarked setup. Built for covert operations and undercover roleplay.",
        images: [
            "/images/durango/1.png",
            "/images/durango/2.png",
            "/images/durango/3.png",
            "/images/durango/4.png",
            "/images/durango/5.png",
            "/images/durango/6.png",
        ],
    },
    {
        id: "setina-pb400",
        name: "2020 FPIU Setina PB400",
        category: "dev-parts",
        price: 10,
        tag: "Developer Parts",
        desc: "Fitted for GMs 2020 FPIU. Based on a high poly model by S1lly with assistance from WildFyr.",
        credits: "Textures: @+WildFyr+ · Model: @S1lly & @+WildFyr+",
        warning: "⚠ LODs provided but not recommended for production use.",
        lods: [
            { l: "L0", v: "4k" },
            { l: "L1", v: "3k" },
            { l: "L2", v: "2k" },
            { l: "L3", v: "1k" },
            { l: "L4", v: "1.6k" },
        ],
        images: [
            "/images/setina/1.png",
            "/images/setina/2.png",
            "/images/setina/3.png",
            "/images/setina/4.png",
        ],
    },
];

export function getProductById(id) {
    return DEFAULT_PRODUCTS.find((product) => product.id === id);
}