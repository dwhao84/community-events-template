// The organizer-defined page at /page.html (後台「自訂頁面」): its name (also the menu tab label), whether the tab is shown,
// and its blocks are all set in the admin and take effect as soon as they are saved. Until then it shows a neutral placeholder
// and no tab. Same block types and limits as the About page.
export const defaultPageTitle='社區資訊';
export const defaultCustomPage=()=>[
 {type:'hero',tone:'accent',align:'left',title:defaultPageTitle,text:'這一頁的名稱與內容由主辦方在後台「自訂頁面」設定。'}
];
