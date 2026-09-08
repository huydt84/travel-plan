import { messages as trackerMessages } from "./i18n-tracker.mjs";
import { messages as adminMessages } from "./i18n-admin.mjs";
import { messages as invitationMessages } from "./i18n-invitations.mjs";
import { messages as assistantMessages } from "./i18n-assistant.mjs";

export const DEFAULT_LOCALE = "vi";

export const LOCALE_META = Object.freeze({
  vi: Object.freeze({ html: "vi", intl: "vi-VN", label: "Tiếng Việt", short: "VI" }),
  en: Object.freeze({ html: "en", intl: "en-US", label: "English", short: "EN" }),
  ja: Object.freeze({ html: "ja", intl: "ja-JP", label: "日本語", short: "JA" }),
});

export const LOCALE_COOKIE = "travel-plan-locale";
export const SUPPORTED_LOCALES = Object.freeze(Object.keys(LOCALE_META));

export const normalizeLocale = (value) => {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const normalized = value.toLowerCase().split("-")[0];
  return Object.hasOwn(LOCALE_META, normalized) ? normalized : DEFAULT_LOCALE;
};

const messages = {
  vi: {
    "language.label": "Ngôn ngữ",
    "language.choose": "Chọn ngôn ngữ",
    "app.title": "Lịch trình chuyến đi",
    "app.description": "Lịch trình chuyến đi theo thời gian thực.",
    "common.backToTrip": "Về lịch trình",
    "common.backToSchedule": "Về lịch",
    "common.close": "Đóng",
    "common.cancel": "Hủy",
    "common.retry": "Hãy thử lại",
    "common.loading": "Đang tải…",
    "common.noData": "Chưa có dữ liệu",
    "common.login": "Đăng nhập",
    "common.loginContinue": "Đăng nhập để tiếp tục",
    "common.loginGoogle": "Tiếp tục với Google",
    "common.logout": "Đăng xuất",
    "common.manage": "Quản lý",
    "common.save": "Lưu thay đổi",
    "common.saving": "Đang lưu…",
    "common.edit": "Chỉnh sửa",
    "common.delete": "Xóa",
    "common.add": "Thêm",
    "common.previous": "Trước",
    "common.next": "Sau",
    "common.today": "hôm nay",
    "common.yesterday": "hôm qua",
    "common.tomorrow": "ngày mai",
    "common.inProgress": "đang diễn ra",
    "nav.selectTrip": "Chọn chuyến đi",
    "nav.change": "Đổi",
    "nav.invite": "Rủ bạn đi cùng",
    "nav.account": "Tài khoản",
    "nav.openAccount": "Mở menu tài khoản của {name}",
    "nav.myRequests": "Yêu cầu của tôi",
    "nav.adminArea": "Khu vực quản lý",
    "nav.adminTrips": "Lịch trình",
    "nav.adminRequests": "Yêu cầu",
    "nav.adminInvitations": "Lời rủ",
    "nav.adminUsers": "Người dùng",
    "nav.adminAssistant": "Quản lý trợ lý",
    "nav.currentTimeAt": "Giờ hiện tại tại {timezone}",
    "tracker.chooseTrip": "Chọn chuyến khác",
    "tracker.chooseDay": "Chọn ngày trong chuyến đi",
    "tracker.day": "Ngày {number}",
    "tracker.activities": "{count} hoạt động",
    "tracker.noSchedule": "Chưa có lịch",
    "tracker.currentRoute": "Tuyến lịch trình hiện tại",
    "tracker.fullSchedule": "Toàn bộ lịch trình",
    "tracker.backToEnd": "Về điểm cuối",
    "tracker.backToCurrent": "Về hiện tại",
    "tracker.current": "Ngay lúc này",
    "tracker.nextActivity": "Hoạt động tiếp theo",
    "tracker.tripStartsIn": "Chuyến đi bắt đầu sau",
    "tracker.tripComplete": "Hành trình hoàn tất",
    "tracker.tripCompleted": "Chuyến đi đã hoàn tất",
    "tracker.completedAt": "Hoàn tất lúc {time}",
    "tracker.activitiesPassed": "Đã đi qua {count} hoạt động trong lịch trình.",
    "tracker.previewing": "Đang xem trước",
    "tracker.remaining": "còn lại",
    "tracker.untilDeparture": "đến giờ đi",
    "tracker.untilActivity": "đến hoạt động",
    "tracker.hoursMinutes": "giờ · phút",
    "tracker.minutesSeconds": "phút · giây",
    "tracker.notesForTrip": "Ghi chú cho cả chuyến",
    "tracker.addNote": "Thêm ghi chú",
    "tracker.placeSources": "Nguồn địa điểm",
    "tracker.noActivities": "Chưa có hoạt động",
    "tracker.noActivitiesDescription": "Chuyến đi này chưa có mục lịch trình nào.",
    "tracker.loginToComment": "Đăng nhập để góp ý",
    "tracker.addTripNote": "Góp ý cho cả chuyến",
    "tracker.addActivityNote": "Góp ý cho hoạt động này",
    "tracker.end": "Điểm cuối",
    "tracker.now": "Hiện tại",
    "tracker.status.before": "Sắp bắt đầu",
    "tracker.status.active": "Đang {type}",
    "tracker.status.gap": "Đang chờ",
    "tracker.status.after": "Đã kết thúc",
    "tracker.tripStartedConfirm": "Chuyến đi đã bắt đầu. Đổi sang “{branch}” có thể làm thay đổi hoạt động hiện tại và tiếp theo. Tiếp tục?",
    "tracker.branchError": "Không thể đổi phương án. Hãy thử lại.",
    "requests.title": "Yêu cầu chuyến đi",
    "requests.loginDescription": "Đăng nhập bằng Google để gửi yêu cầu và theo dõi lịch trình được tạo cho bạn.",
    "requests.description": "Gửi nơi bạn muốn đến. Lịch trình hoàn chỉnh sẽ quay lại đúng tài khoản này.",
    "requests.summary": "Tóm tắt yêu cầu",
    "requests.open": "đang chờ",
    "requests.fulfilled": "đã tạo lịch",
    "requests.new": "Yêu cầu mới",
    "requests.save": "Lưu yêu cầu",
    "requests.send": "Gửi yêu cầu chuyến đi",
    "requests.withdraw": "Rút yêu cầu",
    "requests.restore": "Khôi phục yêu cầu",
    "requests.discardConfirm": "Bỏ các thay đổi chưa lưu trong yêu cầu này?",
    "requests.sent": "Đã gửi yêu cầu chuyến đi.",
    "requests.updated": "Đã lưu thay đổi trong yêu cầu.",
    "requests.withdrawn": "Đã rút yêu cầu.",
    "requests.restored": "Đã khôi phục yêu cầu vào hàng chờ.",
    "requests.fields.startDate": "Ngày bắt đầu",
    "requests.fields.endDate": "Ngày kết thúc",
    "requests.fields.places": "Địa điểm muốn đến",
    "requests.fields.notes": "Ghi chú",
    "requests.desiredDates": "Thời gian mong muốn", "requests.placesCount": "{count} điểm muốn đi", "requests.notesForPlanner": "Ghi chú cho người lên lịch", "requests.referenceSources": "Nguồn tham khảo", "requests.noReferences": "Chưa có liên kết tham khảo.", "requests.declinedTitle": "Yêu cầu chưa thể thực hiện", "requests.noDecisionReason": "Admin chưa ghi thêm lý do.", "requests.scheduleReady": "Lịch trình đã sẵn sàng", "requests.viewSchedule": "Xem lịch trình", "requests.requester": "Người yêu cầu", "requests.requestId": "Mã yêu cầu", "requests.status": "Trạng thái", "requests.status.open": "Đang chờ", "requests.status.fulfilled": "Đã có lịch", "requests.status.declined": "Không thực hiện", "requests.status.withdrawn": "Đã rút", "requests.empty": "Chưa có yêu cầu nào. Bắt đầu bằng ngày đi và nơi bạn đang nghĩ tới.", "requests.chooseRequest": "Chọn một yêu cầu", "requests.chooseRequestDescription": "Xem chi tiết hoặc tạo yêu cầu mới từ tuyến bên trái.", "requests.editing": "Đang chỉnh sửa", "requests.whereToGo": "Bạn muốn đi đâu?", "requests.placesHelp": "Thêm theo thứ tự ưu tiên. Tối đa 12 địa điểm.", "requests.placeNumber": "Địa điểm {number}", "requests.examplePlace": "Ví dụ: Kamakura", "requests.nextPlace": "Địa điểm tiếp theo", "requests.removePlace": "Xoá địa điểm {number}", "requests.addPlace": "Thêm địa điểm", "requests.sourcesHelp": "Không bắt buộc. Tối đa 10 liên kết HTTP(S).", "requests.sourceLabel": "Nhãn", "requests.sourceLabelPlaceholder": "Tên nguồn (không bắt buộc)", "requests.removeSource": "Xoá liên kết {number}", "requests.addSource": "Thêm liên kết", "requests.notesPlaceholder": "Mức độ linh hoạt về ngày, điều đặc biệt cần lưu ý…",
    "requests.desiredDates": "Thời gian mong muốn", "requests.placesCount": "{count} điểm muốn đi", "requests.notesForPlanner": "Ghi chú cho người lên lịch", "requests.referenceSources": "Nguồn tham khảo", "requests.noReferences": "Chưa có liên kết tham khảo.", "requests.declinedTitle": "Yêu cầu chưa thể thực hiện", "requests.noDecisionReason": "Admin chưa ghi thêm lý do.", "requests.scheduleReady": "Lịch trình đã sẵn sàng", "requests.viewSchedule": "Xem lịch trình", "requests.requester": "Người yêu cầu", "requests.requestId": "Mã yêu cầu", "requests.status": "Trạng thái", "requests.status.open": "Đang chờ", "requests.status.fulfilled": "Đã có lịch", "requests.status.declined": "Không thực hiện", "requests.status.withdrawn": "Đã rút",
    "requests.error": "Không thể cập nhật yêu cầu",
    "admin.loginTitle": "Quản lý chuyến đi",
    "admin.loginDescription": "Đăng nhập bằng Google để xem lịch và gửi góp ý. Chỉ chủ lịch mới có quyền chỉnh sửa.",
    "admin.contributorTitle": "Gửi góp ý trên lịch",
    "admin.contributorDescription": "Bạn có thể comment hoặc tạo suggestion ở từng mục lịch, nhưng không thể sửa trực tiếp trip plan.",
    "admin.tripManagement": "Quản lý lịch",
    "admin.tripPlans": "Trip plans",
    "admin.newTrip": "Trip mới",
    "admin.editTrip": "Sửa trip",
    "admin.newActivity": "Thêm hoạt động",
    "admin.newSource": "Nguồn mới",
    "admin.saveActivity": "Lưu hoạt động",
    "admin.saveSource": "Lưu nguồn",
    "admin.addSource": "Thêm nguồn",
    "admin.addActivity": "Thêm hoạt động",
    "admin.daysInTrip": "Các ngày trong chuyến đi",
    "admin.activityCount": "{count} hoạt động đang dùng",
    "admin.suggestions": "{count} góp ý",
    "admin.filterSuggestions": "Lọc góp ý theo hiển thị",
    "admin.noSuggestions": "Chưa có góp ý",
    "admin.users": "Người dùng",
    "admin.userActivity": "Hoạt động người dùng",
    "admin.accountsSummary": "{count} tài khoản Google · quyền admin có hiệu lực từ request kế tiếp.",
    "admin.firstLogin": "Lần đầu đăng nhập",
    "admin.lastActive": "Hoạt động gần nhất",
    "admin.role": "Quyền",
    "admin.ownerFixed": "Cố định",
    "admin.grantAdmin": "Cấp quyền Admin",
    "admin.demoteMember": "Hạ xuống Member",
    "admin.grantAdminConfirm": "Cấp quyền Admin?",
    "admin.demoteMemberConfirm": "Hạ xuống Member?",
    "admin.noUserActivity": "Chưa có hoạt động nào. Tài khoản sẽ xuất hiện sau lần đăng nhập Google tiếp theo.",
    "assistant.title": "Trợ lý hành trình",
    "assistant.history": "Lịch sử",
    "assistant.closeHistory": "Đóng lịch sử",
    "assistant.newConversation": "Trò chuyện mới",
    "assistant.addContext": "Thêm ngữ cảnh",
    "assistant.addTrip": "Thêm chuyến đi này",
    "assistant.pinnedContext": "Ngữ cảnh đã ghim",
    "assistant.messageContext": "Ngữ cảnh tin nhắn",
    "assistant.request": "Yêu cầu cho trợ lý",
    "assistant.placeholder": "Hỏi, tìm kiếm hoặc nhập @ để thêm ngữ cảnh…",
    "assistant.send": "Gửi yêu cầu",
    "assistant.stop": "Dừng",
    "assistant.retry": "Thử lại",
    "assistant.expand": "Mở rộng",
    "assistant.collapse": "Thu nhỏ",
    "assistant.loading": "Đang mở trợ lý…",
    "assistant.loadingAnswer": "Đang chuẩn bị câu trả lời…",
    "assistant.noAnswer": "Chưa có câu trả lời.",
    "assistant.noConversations": "Chưa có cuộc trò chuyện.",
    "assistant.moreConversations": "Xem thêm cuộc trò chuyện",
    "assistant.approvalNeeded": "Cần phê duyệt",
    "assistant.questionNeeded": "Cần bạn trả lời",
    "assistant.approveChanges": "Phê duyệt thay đổi",
    "assistant.saved": "Đã lưu",
    "assistant.reject": "Từ chối",
    "assistant.contextUnavailable": "Ngữ cảnh không còn khả dụng",
    "assistant.requestHistory": "Xem yêu cầu trước",
    "assistant.backToConversation": "Về cuộc trò chuyện",
    "assistant.backToList": "Về danh sách quản trị viên",
    "assistant.readOnly": "Chỉ xem",
    "assistant.administrator": "Quản trị viên",
    "assistant.rules": "Cách tính hạn mức",
    "assistant.settings": "Cài đặt",
    "assistant.generalSettings": "Cài đặt chung",
    "assistant.editSettings": "Chỉnh sửa cài đặt",
    "assistant.dailyRequests": "Yêu cầu/ngày",
    "assistant.weeklyRequests": "Yêu cầu/tuần",
    "assistant.model": "Mô hình",
    "assistant.thinking": "Mức suy nghĩ",
    "assistant.automatic": "Tự động",
    "assistant.unlimited": "Không giới hạn",
    "assistant.enabled": "Đang bật",
    "assistant.disabled": "Đã tắt",
    "assistant.turningOn": "Đang lưu…",
    "assistant.on": "Bật",
    "assistant.off": "Tắt",
    "assistant.loadingData": "Đang tải",
    "invitation.title": "Rủ bạn đi cùng",
    "invitation.close": "Đóng lời rủ",
    "invitation.recipients": "Người nhận",
    "invitation.email": "Email người bạn muốn rủ",
    "invitation.addEmail": "Thêm email",
    "invitation.subject": "Tiêu đề",
    "invitation.message": "Lời nhắn",
    "invitation.send": "Gửi lời rủ",
    "invitation.connectGmail": "Kết nối Gmail",
    "invitation.requestPermission": "Xin quyền gửi lời rủ",
    "invitation.pending": "Đang chờ duyệt",
    "invitation.approved": "Đã được duyệt",
    "invitation.sent": "Đã gửi",
    "invitation.gmailConnected": "Gmail đã kết nối. Kiểm tra lại trước khi gửi.",
    "invitation.gmailNotAuthorized": "Bạn chưa cấp quyền Gmail. Nội dung vẫn được giữ.",
    "invitation.duplicateEmail": "Email này đã có trong danh sách gửi.",
    "invitation.maxRecipients": "Mỗi lượt chỉ có thể gửi tối đa 6 người.",
    "notifications.open": "Mở thông báo",
    "notifications.openWithCount": "Mở thông báo, {label}",
    "notifications.unreadOne": "1 thông báo chưa đọc",
    "notifications.unreadMany": "{count} thông báo chưa đọc",
    "notifications.markAllRead": "Đánh dấu tất cả đã đọc",
    "notifications.empty": "Chưa có thông báo",
    "notifications.loadError": "Không tải được thông báo",
    "notifications.markError": "Không đánh dấu được thông báo",
    "notifications.accepted": "Đã nhận",
    "notifications.resolved": "Đã xử lý",
    "notifications.rejected": "Từ chối",
    "notifications.reopened": "Mở lại",
    "errors.noActivities": "Chưa có hoạt động",
    "errors.scheduleUnavailable": "Lịch tạm thời chưa tải được.",
    "errors.checkConnection": "Kiểm tra kết nối mạng rồi thử tải lại lịch trình.",
    "errors.returningToInvitation": "Đang quay lại lời rủ",
    "errors.savedContent": "Nội dung bạn đã nhập vẫn được giữ.",
  },
  en: {},
  ja: {},
};

const en = {
  "language.label": "Language", "language.choose": "Choose language", "app.title": "Trip schedule", "app.description": "A live trip schedule.",
  "common.backToTrip": "Back to schedule", "common.backToSchedule": "Back to schedule", "common.close": "Close", "common.cancel": "Cancel", "common.retry": "Try again", "common.loading": "Loading…", "common.noData": "No data", "common.login": "Sign in", "common.loginContinue": "Sign in to continue", "common.loginGoogle": "Continue with Google", "common.logout": "Sign out", "common.manage": "Manage", "common.save": "Save changes", "common.saving": "Saving…", "common.edit": "Edit", "common.delete": "Delete", "common.add": "Add", "common.previous": "Previous", "common.next": "Next", "common.today": "today", "common.yesterday": "yesterday", "common.tomorrow": "tomorrow", "common.inProgress": "in progress",
  "nav.selectTrip": "Choose a trip", "nav.change": "Change", "nav.invite": "Invite a friend", "nav.account": "Account", "nav.openAccount": "Open account menu for {name}", "nav.myRequests": "My requests", "nav.adminArea": "Admin area", "nav.adminTrips": "Schedule", "nav.adminRequests": "Requests", "nav.adminInvitations": "Invitations", "nav.adminUsers": "Users", "nav.adminAssistant": "Manage assistant", "nav.currentTimeAt": "Current time in {timezone}",
  "tracker.chooseTrip": "Choose another trip", "tracker.chooseDay": "Choose a day in the trip", "tracker.day": "Day {number}", "tracker.activities": "{count} activities", "tracker.noSchedule": "No schedule", "tracker.currentRoute": "Current route", "tracker.fullSchedule": "Full schedule", "tracker.backToEnd": "Go to end", "tracker.backToCurrent": "Back to now", "tracker.current": "Right now", "tracker.nextActivity": "Next activity", "tracker.tripStartsIn": "Trip starts in", "tracker.tripComplete": "Journey complete", "tracker.tripCompleted": "Trip complete", "tracker.completedAt": "Completed at {time}", "tracker.activitiesPassed": "{count} activities completed in the schedule.", "tracker.previewing": "Previewing", "tracker.remaining": "remaining", "tracker.untilDeparture": "until departure", "tracker.untilActivity": "until activity", "tracker.hoursMinutes": "hours · minutes", "tracker.minutesSeconds": "minutes · seconds", "tracker.notesForTrip": "Notes for the trip", "tracker.addNote": "Add note", "tracker.placeSources": "Place sources", "tracker.noActivities": "No activities", "tracker.noActivitiesDescription": "This trip has no scheduled activities yet.", "tracker.loginToComment": "Sign in to comment", "tracker.addTripNote": "Add a trip note", "tracker.addActivityNote": "Add a note for this activity", "tracker.end": "End", "tracker.now": "Now", "tracker.status.before": "Starting soon", "tracker.status.active": "{type}", "tracker.status.gap": "Waiting", "tracker.status.after": "Completed", "tracker.tripStartedConfirm": "The trip has started. Switching to “{branch}” may change the current and next activities. Continue?", "tracker.branchError": "Could not switch plans. Try again.",
  "requests.title": "Trip requests", "requests.loginDescription": "Sign in with Google to send requests and follow the schedule created for you.", "requests.description": "Tell us where you want to go. The completed schedule will return to this account.", "requests.summary": "Request summary", "requests.open": "open", "requests.fulfilled": "scheduled", "requests.new": "New request", "requests.save": "Save request", "requests.send": "Send trip request", "requests.withdraw": "Withdraw request", "requests.restore": "Restore request", "requests.discardConfirm": "Discard unsaved changes to this request?", "requests.sent": "Trip request sent.", "requests.updated": "Request changes saved.", "requests.withdrawn": "Request withdrawn.", "requests.restored": "Request restored to the queue.", "requests.fields.startDate": "Start date", "requests.fields.endDate": "End date", "requests.fields.places": "Places to visit", "requests.fields.notes": "Notes", "requests.desiredDates": "Desired dates", "requests.placesCount": "{count} places to visit", "requests.notesForPlanner": "Notes for the planner", "requests.referenceSources": "Reference sources", "requests.noReferences": "No reference links yet.", "requests.declinedTitle": "Request could not be fulfilled", "requests.noDecisionReason": "The admin did not add a reason.", "requests.scheduleReady": "Schedule ready", "requests.viewSchedule": "View schedule", "requests.requester": "Requester", "requests.requestId": "Request ID", "requests.status": "Status", "requests.status.open": "Open", "requests.status.fulfilled": "Scheduled", "requests.status.declined": "Not fulfilled", "requests.status.withdrawn": "Withdrawn", "requests.error": "Could not update request",
  "admin.loginTitle": "Trip management", "admin.loginDescription": "Sign in with Google to view the schedule and send feedback. Only the trip owner can edit it.", "admin.contributorTitle": "Send schedule feedback", "admin.contributorDescription": "You can comment or suggest changes on schedule items, but you cannot edit the trip plan directly.", "admin.tripManagement": "Schedule management", "admin.tripPlans": "Trip plans", "admin.newTrip": "New trip", "admin.editTrip": "Edit trip", "admin.newActivity": "Add activity", "admin.newSource": "New source", "admin.saveActivity": "Save activity", "admin.saveSource": "Save source", "admin.addSource": "Add source", "admin.addActivity": "Add activity", "admin.daysInTrip": "Trip days", "admin.activityCount": "{count} activities in use", "admin.suggestions": "{count} suggestions", "admin.filterSuggestions": "Filter suggestions by visibility", "admin.noSuggestions": "No suggestions", "admin.users": "Users", "admin.userActivity": "User activity", "admin.accountsSummary": "{count} Google accounts · admin roles take effect on the next request.", "admin.firstLogin": "First sign-in", "admin.lastActive": "Last active", "admin.role": "Role", "admin.ownerFixed": "Fixed", "admin.grantAdmin": "Grant Admin", "admin.demoteMember": "Demote to Member", "admin.grantAdminConfirm": "Grant Admin access?", "admin.demoteMemberConfirm": "Demote to Member?", "admin.noUserActivity": "No activity yet. Accounts appear after their next Google sign-in.",
  "assistant.title": "Travel assistant", "assistant.history": "History", "assistant.closeHistory": "Close history", "assistant.newConversation": "New conversation", "assistant.addContext": "Add context", "assistant.addTrip": "Add this trip", "assistant.pinnedContext": "Pinned context", "assistant.messageContext": "Message context", "assistant.request": "Request for the assistant", "assistant.placeholder": "Ask, search, or type @ to add context…", "assistant.send": "Send request", "assistant.stop": "Stop", "assistant.retry": "Try again", "assistant.expand": "Expand", "assistant.collapse": "Minimize", "assistant.loading": "Opening assistant…", "assistant.loadingAnswer": "Preparing an answer…", "assistant.noAnswer": "No answer yet.", "assistant.noConversations": "No conversations yet.", "assistant.moreConversations": "View more conversations", "assistant.approvalNeeded": "Needs approval", "assistant.questionNeeded": "Needs your answer", "assistant.approveChanges": "Approve changes", "assistant.saved": "Saved", "assistant.reject": "Reject", "assistant.contextUnavailable": "Context is unavailable", "assistant.requestHistory": "View earlier requests", "assistant.backToConversation": "Back to conversation", "assistant.backToList": "Back to admin list", "assistant.readOnly": "Read only", "assistant.administrator": "Administrator", "assistant.rules": "How limits work", "assistant.settings": "Settings", "assistant.generalSettings": "General settings", "assistant.editSettings": "Edit settings", "assistant.dailyRequests": "Requests/day", "assistant.weeklyRequests": "Requests/week", "assistant.model": "Model", "assistant.thinking": "Thinking level", "assistant.automatic": "Automatic", "assistant.unlimited": "Unlimited", "assistant.enabled": "Enabled", "assistant.disabled": "Disabled", "assistant.turningOn": "Saving…", "assistant.on": "On", "assistant.off": "Off", "assistant.loadingData": "Loading",
  "invitation.title": "Invite a friend", "invitation.close": "Close invitation", "invitation.recipients": "Recipients", "invitation.email": "Friend’s email", "invitation.addEmail": "Add email", "invitation.subject": "Subject", "invitation.message": "Message", "invitation.send": "Send invitation", "invitation.connectGmail": "Connect Gmail", "invitation.requestPermission": "Request invitation access", "invitation.pending": "Pending approval", "invitation.approved": "Approved", "invitation.sent": "Sent", "invitation.gmailConnected": "Gmail connected. Review before sending.", "invitation.gmailNotAuthorized": "Gmail access was not granted. Your content is still saved.", "invitation.duplicateEmail": "This email is already in the recipient list.", "invitation.maxRecipients": "You can send to up to 6 people at a time.",
  "notifications.open": "Open notifications", "notifications.openWithCount": "Open notifications, {label}", "notifications.unreadOne": "1 unread notification", "notifications.unreadMany": "{count} unread notifications", "notifications.markAllRead": "Mark all as read", "notifications.empty": "No notifications", "notifications.loadError": "Could not load notifications", "notifications.markError": "Could not mark notifications", "notifications.accepted": "Accepted", "notifications.resolved": "Resolved", "notifications.rejected": "Rejected", "notifications.reopened": "Reopened",
  "errors.noActivities": "No activities", "errors.scheduleUnavailable": "The schedule could not be loaded.", "errors.checkConnection": "Check your connection and try loading the schedule again.", "errors.returningToInvitation": "Returning to invitation", "errors.savedContent": "Your entered content is still saved.",
};

const ja = {
  "language.label": "言語", "language.choose": "言語を選択", "app.title": "旅行スケジュール", "app.description": "リアルタイムの旅行スケジュールです。",
  "common.backToTrip": "スケジュールに戻る", "common.backToSchedule": "スケジュールに戻る", "common.close": "閉じる", "common.cancel": "キャンセル", "common.retry": "再試行", "common.loading": "読み込み中…", "common.noData": "データなし", "common.login": "ログイン", "common.loginContinue": "ログインして続ける", "common.loginGoogle": "Googleで続ける", "common.logout": "ログアウト", "common.manage": "管理", "common.save": "変更を保存", "common.saving": "保存中…", "common.edit": "編集", "common.delete": "削除", "common.add": "追加", "common.previous": "前へ", "common.next": "次へ", "common.today": "今日", "common.yesterday": "昨日", "common.tomorrow": "明日", "common.inProgress": "進行中",
  "nav.selectTrip": "旅行を選択", "nav.change": "変更", "nav.invite": "友だちを招待", "nav.account": "アカウント", "nav.openAccount": "{name}のアカウントメニューを開く", "nav.myRequests": "自分のリクエスト", "nav.adminArea": "管理エリア", "nav.adminTrips": "スケジュール", "nav.adminRequests": "リクエスト", "nav.adminInvitations": "招待", "nav.adminUsers": "ユーザー", "nav.adminAssistant": "アシスタント管理", "nav.currentTimeAt": "{timezone}の現在時刻",
  "tracker.chooseTrip": "別の旅行を選択", "tracker.chooseDay": "旅行の日を選択", "tracker.day": "{number}日目", "tracker.activities": "{count}件の予定", "tracker.noSchedule": "予定なし", "tracker.currentRoute": "現在のルート", "tracker.fullSchedule": "すべての予定", "tracker.backToEnd": "最後へ", "tracker.backToCurrent": "現在へ戻る", "tracker.current": "現在", "tracker.nextActivity": "次の予定", "tracker.tripStartsIn": "旅行開始まで", "tracker.tripComplete": "旅程完了", "tracker.tripCompleted": "旅行完了", "tracker.completedAt": "完了時刻 {time}", "tracker.activitiesPassed": "予定を{count}件完了しました。", "tracker.previewing": "プレビュー中", "tracker.remaining": "残り", "tracker.untilDeparture": "出発まで", "tracker.untilActivity": "予定まで", "tracker.hoursMinutes": "時間・分", "tracker.minutesSeconds": "分・秒", "tracker.notesForTrip": "旅行全体のメモ", "tracker.addNote": "メモを追加", "tracker.placeSources": "場所の情報源", "tracker.noActivities": "予定なし", "tracker.noActivitiesDescription": "この旅行にはまだ予定がありません。", "tracker.loginToComment": "ログインしてコメント", "tracker.addTripNote": "旅行全体にメモを追加", "tracker.addActivityNote": "この予定にメモを追加", "tracker.end": "最後", "tracker.now": "現在", "tracker.status.before": "まもなく開始", "tracker.status.active": "{type}", "tracker.status.gap": "待機中", "tracker.status.after": "完了", "tracker.tripStartedConfirm": "旅行は開始済みです。「{branch}」に変更すると現在と次の予定が変わる可能性があります。続けますか？", "tracker.branchError": "プランを変更できませんでした。再試行してください。",
  "requests.title": "旅行リクエスト", "requests.loginDescription": "Googleでログインすると、リクエストを送信し、作成されたスケジュールを確認できます。", "requests.description": "行きたい場所を入力してください。完成したスケジュールはこのアカウントに戻ります。", "requests.summary": "リクエスト概要", "requests.open": "受付中", "requests.fulfilled": "予定作成済み", "requests.new": "新しいリクエスト", "requests.save": "リクエストを保存", "requests.send": "旅行リクエストを送信", "requests.withdraw": "リクエストを取り下げる", "requests.restore": "リクエストを復元", "requests.discardConfirm": "このリクエストの未保存の変更を破棄しますか？", "requests.sent": "旅行リクエストを送信しました。", "requests.updated": "リクエストを保存しました。", "requests.withdrawn": "リクエストを取り下げました。", "requests.restored": "リクエストを待機列に戻しました。", "requests.fields.startDate": "開始日", "requests.fields.endDate": "終了日", "requests.fields.places": "行きたい場所", "requests.fields.notes": "メモ", "requests.desiredDates": "希望日程", "requests.placesCount": "行きたい場所 {count} 件", "requests.notesForPlanner": "プランナーへのメモ", "requests.referenceSources": "参考リンク", "requests.noReferences": "参考リンクはまだありません。", "requests.declinedTitle": "リクエストを実行できませんでした", "requests.noDecisionReason": "管理者から理由は追加されていません。", "requests.scheduleReady": "スケジュールの準備ができました", "requests.viewSchedule": "スケジュールを見る", "requests.requester": "依頼者", "requests.requestId": "リクエストID", "requests.status": "ステータス", "requests.status.open": "受付中", "requests.status.fulfilled": "予定作成済み", "requests.status.declined": "実行不可", "requests.status.withdrawn": "取り下げ済み", "requests.error": "リクエストを更新できませんでした",
  "admin.loginTitle": "旅行管理", "admin.loginDescription": "Googleでログインしてスケジュールを確認し、フィードバックを送信します。編集できるのは旅行のオーナーだけです。", "admin.contributorTitle": "スケジュールにフィードバック", "admin.contributorDescription": "予定へのコメントや変更提案はできますが、旅行プランを直接編集することはできません。", "admin.tripManagement": "スケジュール管理", "admin.tripPlans": "旅行プラン", "admin.newTrip": "新しい旅行", "admin.editTrip": "旅行を編集", "admin.newActivity": "予定を追加", "admin.newSource": "新しい情報源", "admin.saveActivity": "予定を保存", "admin.saveSource": "情報源を保存", "admin.addSource": "情報源を追加", "admin.addActivity": "予定を追加", "admin.daysInTrip": "旅行の日程", "admin.activityCount": "{count}件の予定を使用中", "admin.suggestions": "{count}件の提案", "admin.filterSuggestions": "表示状態で提案を絞り込む", "admin.noSuggestions": "提案はありません", "admin.users": "ユーザー", "admin.userActivity": "ユーザーのアクティビティ", "admin.accountsSummary": "Googleアカウント{count}件。管理者権限は次回のリクエストから有効です。", "admin.firstLogin": "初回ログイン", "admin.lastActive": "最終アクティブ", "admin.role": "権限", "admin.ownerFixed": "固定", "admin.grantAdmin": "管理者権限を付与", "admin.demoteMember": "メンバーに戻す", "admin.grantAdminConfirm": "管理者権限を付与しますか？", "admin.demoteMemberConfirm": "メンバーに戻しますか？", "admin.noUserActivity": "アクティビティはまだありません。次回のGoogleログイン後にアカウントが表示されます。",
  "assistant.title": "旅行アシスタント", "assistant.history": "履歴", "assistant.closeHistory": "履歴を閉じる", "assistant.newConversation": "新しい会話", "assistant.addContext": "コンテキストを追加", "assistant.addTrip": "この旅行を追加", "assistant.pinnedContext": "固定したコンテキスト", "assistant.messageContext": "メッセージのコンテキスト", "assistant.request": "アシスタントへのリクエスト", "assistant.placeholder": "質問、検索、または@でコンテキストを追加…", "assistant.send": "リクエストを送信", "assistant.stop": "停止", "assistant.retry": "再試行", "assistant.expand": "拡大", "assistant.collapse": "縮小", "assistant.loading": "アシスタントを開いています…", "assistant.loadingAnswer": "回答を準備中…", "assistant.noAnswer": "回答はまだありません。", "assistant.noConversations": "会話はまだありません。", "assistant.moreConversations": "会話をさらに表示", "assistant.approvalNeeded": "承認が必要", "assistant.questionNeeded": "回答が必要", "assistant.approveChanges": "変更を承認", "assistant.saved": "保存済み", "assistant.reject": "却下", "assistant.contextUnavailable": "コンテキストを利用できません", "assistant.requestHistory": "以前のリクエストを表示", "assistant.backToConversation": "会話に戻る", "assistant.backToList": "管理者一覧に戻る", "assistant.readOnly": "閲覧のみ", "assistant.administrator": "管理者", "assistant.rules": "上限について", "assistant.settings": "設定", "assistant.generalSettings": "全般設定", "assistant.editSettings": "設定を編集", "assistant.dailyRequests": "1日のリクエスト", "assistant.weeklyRequests": "1週間のリクエスト", "assistant.model": "モデル", "assistant.thinking": "思考レベル", "assistant.automatic": "自動", "assistant.unlimited": "無制限", "assistant.enabled": "有効", "assistant.disabled": "無効", "assistant.turningOn": "保存中…", "assistant.on": "オン", "assistant.off": "オフ", "assistant.loadingData": "読み込み中",
  "invitation.title": "友だちを招待", "invitation.close": "招待を閉じる", "invitation.recipients": "宛先", "invitation.email": "友だちのメールアドレス", "invitation.addEmail": "メールを追加", "invitation.subject": "件名", "invitation.message": "メッセージ", "invitation.send": "招待を送信", "invitation.connectGmail": "Gmailに接続", "invitation.requestPermission": "招待送信の権限を申請", "invitation.pending": "承認待ち", "invitation.approved": "承認済み", "invitation.sent": "送信済み", "invitation.gmailConnected": "Gmailに接続しました。送信前に確認してください。", "invitation.gmailNotAuthorized": "Gmailへのアクセスは許可されませんでした。入力内容は保存されています。", "invitation.duplicateEmail": "このメールアドレスはすでに宛先にあります。", "invitation.maxRecipients": "一度に送信できる宛先は6人までです。",
  "notifications.open": "通知を開く", "notifications.openWithCount": "通知を開く、{label}", "notifications.unreadOne": "未読通知1件", "notifications.unreadMany": "未読通知{count}件", "notifications.markAllRead": "すべて既読にする", "notifications.empty": "通知はありません", "notifications.loadError": "通知を読み込めませんでした", "notifications.markError": "通知を既読にできませんでした", "notifications.accepted": "受け付け済み", "notifications.resolved": "処理済み", "notifications.rejected": "却下", "notifications.reopened": "再開",
  "errors.noActivities": "予定なし", "errors.scheduleUnavailable": "スケジュールを読み込めませんでした。", "errors.checkConnection": "接続を確認して、もう一度スケジュールを読み込んでください。", "errors.returningToInvitation": "招待に戻っています", "errors.savedContent": "入力内容は保存されています。",
};

Object.assign(messages.en, en);
Object.assign(messages.ja, ja);
Object.assign(messages.vi, {
  "admin.openScheduleFeedback": "Mở lịch để góp ý", "assistant.open": "Mở trợ lý", "assistant.newAnswers": "{count} câu trả lời mới", "assistant.unpin": "Bỏ ghim", "assistant.messageLabel": "Nhắn cho trợ lý", "assistant.keyboardHint": "Enter để gửi · Shift + Enter để xuống dòng.", "assistant.applyReminder": "Chỉ sửa lịch sau khi bạn áp dụng.", "assistant.loadingConversation": "Đang tải cuộc trò chuyện…", "assistant.loadingConversations": "Đang tải hội thoại…", "assistant.pinnedCount": "{count} ngữ cảnh đã ghim", "assistant.answering": "Đang trả lời", "assistant.questionNeeded": "Cần bạn trả lời", "assistant.ownerCanView": "Owner có thể xem các cuộc trò chuyện của admin.", "assistant.disabledReadOnly": "Trợ lý đã tắt · Chỉ đọc lịch sử", "assistant.quotaReached": "Đã hết hạn mức trợ lý", "assistant.accessAndLimits": "Quyền và hạn mức sử dụng", "assistant.providerDefault": "Mặc định nhà cung cấp", "assistant.minimal": "Tối thiểu", "assistant.low": "Thấp", "assistant.medium": "Trung bình", "assistant.high": "Cao", "assistant.remainingToday": "Còn {count} yêu cầu hôm nay", "assistant.remainingWeek": "Còn {count} yêu cầu trong tuần", "assistant.resetAt": "Đặt lại (JST): ngày {daily}; tuần {weekly}.", "assistant.firstRunTitle": "Cùng lên một chuyến đi vừa ý hơn.", "assistant.firstRunDescription": "Hỏi về lịch trình, tìm hiểu điểm đến, hoặc chuẩn bị thay đổi. Bạn luôn là người quyết định.", "assistant.promptDestination": "Gợi ý điểm đến cho cuối tuần", "assistant.promptExisting": "Tìm các chuyến đi đã có", "assistant.promptCompare": "So sánh hai chuyến đi", "assistant.unread": "Chưa đọc",
  "context.trip": "Chuyến đi", "context.activity": "Hoạt động", "context.source": "Nguồn", "context.contribution": "Góp ý", "context.place": "Địa điểm đã lưu", "context.pin": "Ghim", "context.searchLabel": "Tìm trong chuyến đi và tài liệu", "context.searchPlaceholder": "Tên chuyến đi, hoạt động, địa điểm…", "context.kindLabel": "Loại ngữ cảnh", "context.all": "Tất cả tài liệu", "context.searching": "Đang tìm…", "context.googlePrompt": "Nhập tên địa điểm để tìm trên Google Maps.", "context.noResults": "Không tìm thấy ngữ cảnh phù hợp.",
  "notifications.title": "Thông báo", "notifications.allCaughtUp": "Bạn đã xem hết các cập nhật mới", "notifications.forYou": "Cập nhật dành cho bạn", "notifications.marking": "Đang đánh dấu…", "notifications.feedUnavailable": "Chưa nối được bảng tin", "notifications.emptyFeed": "Chưa có cập nhật", "notifications.emptyDescription": "Khi có cập nhật về góp ý hoặc yêu cầu chuyến đi, thông báo sẽ xuất hiện tại đây.", "notifications.read": "Đã đọc", "notifications.unread": "Chưa đọc", "notifications.more": "Xem thêm cập nhật", "notifications.tripReady": "Lịch trình cho yêu cầu của bạn đã sẵn sàng", "notifications.contentHidden": "Nội dung của bạn đã được ẩn", "notifications.contentShown": "Nội dung của bạn đã được hiện lại", "notifications.contributionStatus": "Góp ý của bạn: {status}", "notifications.updated": "Đã cập nhật", "notifications.commented": "đã bình luận", "notifications.suggested": "đã gửi một đề xuất", "notifications.wholeTrip": "Cả chuyến đi",
});
Object.assign(messages.vi, { "assistant.conversationHistory": "Lịch sử trò chuyện", "assistant.conversationsLabel": "Hội thoại", "assistant.launcherLabel": "Trợ lý", "assistant.scheduleLink": "Lịch trình", "assistant.olderTurns": "Xem trao đổi trước", "assistant.longConversationWarning": "Hội thoại đã dài — hãy bắt đầu phiên mới để trả lời nhanh hơn", "assistant.newSession": "Phiên mới", "tracker.emptyDayTitle": "Ngày này chưa có hoạt động", "common.updatedAt": "Cập nhật {time}", "invitation.resendAt": "Có thể gửi lại từ {time}." });
Object.assign(messages.en, { "assistant.conversationHistory": "Conversation history", "assistant.conversationsLabel": "Conversations", "assistant.launcherLabel": "Assistant", "assistant.scheduleLink": "Schedule", "assistant.olderTurns": "View earlier exchanges", "assistant.longConversationWarning": "Conversation is getting long — start a new session for faster replies", "assistant.newSession": "New session", "tracker.emptyDayTitle": "No activities on this day", "common.updatedAt": "Updated {time}", "invitation.resendAt": "You can send again from {time}." });
Object.assign(messages.ja, { "assistant.conversationHistory": "会話履歴", "assistant.conversationsLabel": "会話", "assistant.launcherLabel": "アシスタント", "assistant.scheduleLink": "スケジュール", "assistant.olderTurns": "以前のやり取りを表示", "assistant.longConversationWarning": "会話が長くなっています — 新しいセッションを開始すると応答が速くなります", "assistant.newSession": "新しいセッション", "tracker.emptyDayTitle": "この日の予定はありません", "common.updatedAt": "更新 {time}", "invitation.resendAt": "{time} 以降に再送できます。" });
Object.assign(messages.en, {
  "admin.openScheduleFeedback": "Open schedule to comment", "assistant.open": "Open assistant", "assistant.newAnswers": "{count} new answers", "assistant.unpin": "Unpin", "assistant.messageLabel": "Message the assistant", "assistant.keyboardHint": "Enter to send · Shift + Enter for a new line.", "assistant.applyReminder": "Schedule changes only happen after you apply them.", "assistant.loadingConversation": "Loading conversation…", "assistant.loadingConversations": "Loading conversations…", "assistant.pinnedCount": "{count} pinned context items", "assistant.answering": "Answering", "assistant.ownerCanView": "The owner can view admins’ conversations.", "assistant.disabledReadOnly": "Assistant disabled · History is read-only", "assistant.quotaReached": "Assistant limit reached", "assistant.accessAndLimits": "Access and usage limits", "assistant.providerDefault": "Provider default", "assistant.minimal": "Minimal", "assistant.low": "Low", "assistant.medium": "Medium", "assistant.high": "High", "assistant.remainingToday": "{count} requests left today", "assistant.remainingWeek": "{count} requests left this week", "assistant.resetAt": "Resets (JST): day {daily}; week {weekly}.", "assistant.firstRunTitle": "Plan a better trip together.", "assistant.firstRunDescription": "Ask about a schedule, explore places, or prepare a change. You always decide.", "assistant.promptDestination": "Suggest a weekend destination", "assistant.promptExisting": "Find existing trips", "assistant.promptCompare": "Compare two trips", "assistant.unread": "Unread",
  "context.trip": "Trip", "context.activity": "Activity", "context.source": "Source", "context.contribution": "Feedback", "context.place": "Saved place", "context.pin": "Pin", "context.searchLabel": "Search trips and documents", "context.searchPlaceholder": "Trip, activity, or place name…", "context.kindLabel": "Context type", "context.all": "All documents", "context.searching": "Searching…", "context.googlePrompt": "Enter a place name to search Google Maps.", "context.noResults": "No matching context found.",
  "notifications.title": "Notifications", "notifications.allCaughtUp": "You’re all caught up", "notifications.forYou": "Updates for you", "notifications.marking": "Marking…", "notifications.feedUnavailable": "The feed is unavailable", "notifications.emptyFeed": "No updates yet", "notifications.emptyDescription": "Updates about feedback or trip requests will appear here.", "notifications.read": "Read", "notifications.unread": "Unread", "notifications.more": "View more updates", "notifications.tripReady": "The schedule for your request is ready", "notifications.contentHidden": "Your content was hidden", "notifications.contentShown": "Your content is visible again", "notifications.contributionStatus": "Your feedback: {status}", "notifications.updated": "Updated", "notifications.commented": "commented", "notifications.suggested": "sent a suggestion", "notifications.wholeTrip": "Whole trip",
});
Object.assign(messages.ja, {
  "admin.openScheduleFeedback": "スケジュールを開いてコメント", "assistant.open": "アシスタントを開く", "assistant.newAnswers": "新しい回答 {count} 件", "assistant.unpin": "固定を解除", "assistant.messageLabel": "アシスタントへのメッセージ", "assistant.keyboardHint": "Enterで送信 · Shift + Enterで改行。", "assistant.applyReminder": "変更は適用後にのみスケジュールへ反映されます。", "assistant.loadingConversation": "会話を読み込み中…", "assistant.loadingConversations": "会話を読み込み中…", "assistant.pinnedCount": "固定したコンテキスト {count} 件", "assistant.answering": "回答中", "assistant.ownerCanView": "オーナーは管理者の会話を閲覧できます。", "assistant.disabledReadOnly": "アシスタント無効 · 履歴のみ閲覧可能", "assistant.quotaReached": "アシスタントの上限に達しました", "assistant.accessAndLimits": "アクセスと利用上限", "assistant.providerDefault": "プロバイダーの既定値", "assistant.minimal": "最小", "assistant.low": "低", "assistant.medium": "中", "assistant.high": "高", "assistant.remainingToday": "本日の残り {count} 件", "assistant.remainingWeek": "今週の残り {count} 件", "assistant.resetAt": "リセット（JST）：日次 {daily}、週次 {weekly}。", "assistant.firstRunTitle": "一緒に、もっと良い旅を計画しましょう。", "assistant.firstRunDescription": "スケジュールについて質問したり、場所を調べたり、変更案を準備できます。決めるのはあなたです。", "assistant.promptDestination": "週末の行き先を提案", "assistant.promptExisting": "既存の旅行を探す", "assistant.promptCompare": "2つの旅行を比較", "assistant.unread": "未読",
  "context.trip": "旅行", "context.activity": "予定", "context.source": "情報源", "context.contribution": "コメント", "context.place": "保存した場所", "context.pin": "固定", "context.searchLabel": "旅行とドキュメントを検索", "context.searchPlaceholder": "旅行、予定、場所の名前…", "context.kindLabel": "コンテキストの種類", "context.all": "すべての資料", "context.searching": "検索中…", "context.googlePrompt": "Google Mapsで検索する場所を入力してください。", "context.noResults": "一致するコンテキストが見つかりません。",
  "notifications.title": "通知", "notifications.allCaughtUp": "新しい通知はありません", "notifications.forYou": "あなたへの更新", "notifications.marking": "既読にしています…", "notifications.feedUnavailable": "通知を利用できません", "notifications.emptyFeed": "更新はまだありません", "notifications.emptyDescription": "コメントや旅行リクエストの更新がここに表示されます。", "notifications.read": "既読", "notifications.unread": "未読", "notifications.more": "更新をさらに表示", "notifications.tripReady": "リクエストのスケジュールが準備できました", "notifications.contentHidden": "あなたの内容は非表示になりました", "notifications.contentShown": "あなたの内容が再表示されました", "notifications.contributionStatus": "あなたのコメント：{status}", "notifications.updated": "更新済み", "notifications.commented": "がコメントしました", "notifications.suggested": "が提案を送りました", "notifications.wholeTrip": "旅行全体",
});
Object.assign(messages.en, {
  "requests.desiredDates": "Desired dates", "requests.placesCount": "{count} places to visit", "requests.notesForPlanner": "Notes for the planner", "requests.referenceSources": "Reference sources", "requests.noReferences": "No reference links yet.", "requests.declinedTitle": "Request could not be fulfilled", "requests.noDecisionReason": "The admin did not add a reason.", "requests.scheduleReady": "Schedule ready", "requests.viewSchedule": "View schedule", "requests.requester": "Requester", "requests.requestId": "Request ID", "requests.status": "Status", "requests.status.open": "Open", "requests.status.fulfilled": "Scheduled", "requests.status.declined": "Not fulfilled", "requests.status.withdrawn": "Withdrawn", "requests.empty": "No requests yet. Start with travel dates and a place you have in mind.", "requests.chooseRequest": "Choose a request", "requests.chooseRequestDescription": "View details or create a new request from the list on the left.", "requests.editing": "Editing", "requests.whereToGo": "Where do you want to go?", "requests.placesHelp": "Add places in priority order. Up to 12 places.", "requests.placeNumber": "Place {number}", "requests.examplePlace": "Example: Kamakura", "requests.nextPlace": "Next place", "requests.removePlace": "Remove place {number}", "requests.addPlace": "Add place", "requests.sourcesHelp": "Optional. Up to 10 HTTP(S) links.", "requests.sourceLabel": "Label", "requests.sourceLabelPlaceholder": "Source name (optional)", "requests.removeSource": "Remove link {number}", "requests.addSource": "Add link", "requests.notesPlaceholder": "Date flexibility or anything important to note…",
});
Object.assign(messages.ja, {
  "requests.desiredDates": "希望日程", "requests.placesCount": "行きたい場所 {count} 件", "requests.notesForPlanner": "プランナーへのメモ", "requests.referenceSources": "参考リンク", "requests.noReferences": "参考リンクはまだありません。", "requests.declinedTitle": "リクエストを実行できませんでした", "requests.noDecisionReason": "管理者から理由は追加されていません。", "requests.scheduleReady": "スケジュールの準備ができました", "requests.viewSchedule": "スケジュールを見る", "requests.requester": "依頼者", "requests.requestId": "リクエストID", "requests.status": "ステータス", "requests.status.open": "受付中", "requests.status.fulfilled": "予定作成済み", "requests.status.declined": "実行不可", "requests.status.withdrawn": "取り下げ済み", "requests.empty": "リクエストはまだありません。旅行日と行きたい場所から始めましょう。", "requests.chooseRequest": "リクエストを選択", "requests.chooseRequestDescription": "詳細を確認するか、左の一覧から新しいリクエストを作成してください。", "requests.editing": "編集中", "requests.whereToGo": "どこへ行きたいですか？", "requests.placesHelp": "優先順に入力してください。最大12か所です。", "requests.placeNumber": "場所 {number}", "requests.examplePlace": "例：鎌倉", "requests.nextPlace": "次の場所", "requests.removePlace": "場所 {number} を削除", "requests.addPlace": "場所を追加", "requests.sourcesHelp": "任意。HTTP(S)リンクは最大10件です。", "requests.sourceLabel": "ラベル", "requests.sourceLabelPlaceholder": "ソース名（任意）", "requests.removeSource": "リンク {number} を削除", "requests.addSource": "リンクを追加", "requests.notesPlaceholder": "日程の柔軟性や注意点…",
});

Object.assign(messages.vi, {
  "notifications.tripLinked": "{actor} đã gắn “{trip}” với yêu cầu của bạn.",
  "notifications.visibilityChanged": "{actor} đã đổi mức hiển thị nội dung của bạn.",
  "notifications.statusChanged": "{actor} đã đổi trạng thái góp ý của bạn.",
  "notifications.loading": "Đang tải thông báo",
});
Object.assign(messages.en, {
  "notifications.tripLinked": "{actor} linked “{trip}” to your request.",
  "notifications.visibilityChanged": "{actor} changed the visibility of your content.",
  "notifications.statusChanged": "{actor} changed the status of your feedback.",
  "notifications.loading": "Loading notifications",
});
Object.assign(messages.ja, {
  "notifications.tripLinked": "{actor}が「{trip}」をあなたのリクエストに関連付けました。",
  "notifications.visibilityChanged": "{actor}があなたの内容の公開設定を変更しました。",
  "notifications.statusChanged": "{actor}があなたのコメントのステータスを変更しました。",
  "notifications.loading": "通知を読み込み中",
});

Object.assign(messages.vi, {
  "metadata.adminTrips": "Quản lý lịch chuyến đi", "metadata.adminUsers": "Quản lý người dùng",
  "metadata.adminInvitations": "Quản lý lời rủ", "metadata.adminRequests": "Quản lý yêu cầu chuyến đi",
  "errors.scheduleTitle": "Lịch tạm thời chưa tải được.", "errors.scheduleHelp": "Kiểm tra kết nối mạng rồi thử tải lại lịch trình.",
  "errors.returnToInvite": "Đang quay lại lời rủ", "errors.invitePreserved": "Nội dung bạn đã nhập vẫn được giữ.",
});
Object.assign(messages.en, {
  "metadata.adminTrips": "Manage trip schedules", "metadata.adminUsers": "Manage users",
  "metadata.adminInvitations": "Manage invitations", "metadata.adminRequests": "Manage trip requests",
  "errors.scheduleTitle": "The schedule could not be loaded.", "errors.scheduleHelp": "Check your connection and try loading the schedule again.",
  "errors.returnToInvite": "Returning to your invitation", "errors.invitePreserved": "The content you entered has been preserved.",
});
Object.assign(messages.ja, {
  "metadata.adminTrips": "旅行スケジュール管理", "metadata.adminUsers": "ユーザー管理",
  "metadata.adminInvitations": "招待管理", "metadata.adminRequests": "旅行リクエスト管理",
  "errors.scheduleTitle": "スケジュールを読み込めませんでした。", "errors.scheduleHelp": "接続を確認して、もう一度読み込んでください。",
  "errors.returnToInvite": "招待画面に戻っています", "errors.invitePreserved": "入力した内容は保存されています。",
});

Object.assign(messages.vi, {
  "profile.displayName": "Tên hiển thị",
  "profile.edit": "Đổi tên",
  "profile.editTitle": "Đổi tên hiển thị",
  "profile.description": "Tên này sẽ xuất hiện trên lịch, góp ý và các hoạt động của bạn.",
  "profile.displayNameRequired": "Hãy nhập tên hiển thị.",
  "profile.saveError": "Không thể lưu tên hiển thị.",
});
Object.assign(messages.en, {
  "profile.displayName": "Display name",
  "profile.edit": "Edit name",
  "profile.editTitle": "Change display name",
  "profile.description": "This name will appear on the schedule, feedback, and your activity.",
  "profile.displayNameRequired": "Enter a display name.",
  "profile.saveError": "Could not save the display name.",
});
Object.assign(messages.ja, {
  "profile.displayName": "表示名",
  "profile.edit": "名前を変更",
  "profile.editTitle": "表示名を変更",
  "profile.description": "この名前はスケジュール、コメント、あなたのアクティビティに表示されます。",
  "profile.displayNameRequired": "表示名を入力してください。",
  "profile.saveError": "表示名を保存できませんでした。",
});

for (const locale of SUPPORTED_LOCALES) {
  Object.assign(messages[locale], trackerMessages[locale], adminMessages[locale], invitationMessages[locale], assistantMessages[locale]);
}

export const localeMessages = messages;

export const translate = (locale, key, values = {}) => {
  const language = normalizeLocale(locale);
  const template = Object.hasOwn(messages[language], key) ? messages[language][key]
    : Object.hasOwn(messages[DEFAULT_LOCALE], key) ? messages[DEFAULT_LOCALE][key] : key;
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder);
};

export const getIntlLocale = (locale) => LOCALE_META[normalizeLocale(locale)].intl;

const activityTypes = {
  vi: { Visit: "THAM QUAN", Walk: "ĐI BỘ", Transit: "DI CHUYỂN", Cafe: "CÀ PHÊ", Lunch: "ĂN TRƯA", Dinner: "BỮA TỐI", Show: "BIỂU DIỄN", Festival: "LỄ HỘI", Relax: "THƯ GIÃN", Break: "NGHỈ", Reservation: "ĐẶT CHỖ", Meet: "TẬP TRUNG" },
  en: { Visit: "VISIT", Walk: "WALK", Transit: "TRANSIT", Cafe: "CAFE", Lunch: "LUNCH", Dinner: "DINNER", Show: "SHOW", Festival: "FESTIVAL", Relax: "RELAX", Break: "BREAK", Reservation: "RESERVATION", Meet: "MEET" },
  ja: { Visit: "観光", Walk: "徒歩", Transit: "移動", Cafe: "カフェ", Lunch: "ランチ", Dinner: "夕食", Show: "ショー", Festival: "フェス", Relax: "休憩", Break: "休憩", Reservation: "予約", Meet: "集合" },
};

Object.assign(activityTypes.vi, { Film: "QUAY PHIM / CHỤP ẢNH", Buffer: "THỜI GIAN ĐỆM", Rest: "NGHỈ", Picnic: "DÃ NGOẠI", Indoor: "TRONG NHÀ" });
Object.assign(activityTypes.en, { Film: "FILM / PHOTOS", Buffer: "BUFFER TIME", Rest: "REST", Picnic: "PICNIC", Indoor: "INDOORS" });
Object.assign(activityTypes.ja, { Film: "動画・写真撮影", Buffer: "予備時間", Rest: "休憩", Picnic: "ピクニック", Indoor: "屋内" });

export const translateActivityType = (locale, type) => Object.hasOwn(activityTypes[normalizeLocale(locale)], type)
  ? activityTypes[normalizeLocale(locale)][type] : type;
