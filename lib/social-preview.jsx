import { ImageResponse } from "next/og";

export const socialPreviewSize = {
  width: 1200,
  height: 630,
};

export const socialPreviewAlt = "Lịch trình chuyến đi theo thời gian thực";

const timelineItems = [
  { time: "08:30", label: "Khởi hành", color: "#df5c4d" },
  { time: "11:00", label: "Khám phá", color: "#e9a16f" },
  { time: "18:30", label: "Thư giãn", color: "#1e7167" },
];

export function renderSocialPreview() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: "54px",
          color: "#17332f",
          background: "#f3f0e9",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            background: "radial-gradient(circle at 12% 0%, rgba(238, 174, 150, 0.34), transparent 38%)",
          }}
        />

        <div
          style={{
            position: "relative",
            width: "100%",
            display: "flex",
            overflow: "hidden",
            border: "1px solid rgba(23, 51, 47, 0.10)",
            borderRadius: "34px",
            background: "#fffdf8",
            boxShadow: "0 28px 80px rgba(27, 52, 47, 0.13)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "9px",
              display: "flex",
              background: "linear-gradient(90deg, #df5c4d, #e9a16f 46%, #1e7167)",
            }}
          />

          <div
            style={{
              width: "62%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "72px 64px 58px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  alignSelf: "flex-start",
                  display: "flex",
                  padding: "10px 16px",
                  borderRadius: "999px",
                  color: "#1e7167",
                  background: "#dceae4",
                  fontSize: "18px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Kế hoạch trong tầm tay
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginTop: "28px",
                  fontSize: "72px",
                  fontWeight: 700,
                  lineHeight: 1.02,
                  letterSpacing: "-0.045em",
                }}
              >
                <span style={{ display: "flex" }}>Lịch trình</span>
                <span style={{ display: "flex" }}>chuyến đi</span>
              </div>
              <div
                style={{
                  display: "flex",
                  maxWidth: "590px",
                  marginTop: "22px",
                  color: "#66736f",
                  fontSize: "27px",
                  lineHeight: 1.4,
                }}
              >
                Theo dõi từng điểm đến và giữ nhịp hành trình theo thời gian thực.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", color: "#1e7167", fontSize: "20px", fontWeight: 700 }}>
              Trip schedule
            </div>
          </div>

          <div
            style={{
              width: "38%",
              display: "flex",
              alignItems: "center",
              padding: "60px 54px 60px 10px",
            }}
          >
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "34px 32px",
                borderRadius: "26px",
                background: "#f3f0e9",
              }}
            >
              <div style={{ display: "flex", marginBottom: "28px", color: "#df5c4d", fontSize: "16px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Lịch hôm nay
              </div>
              {timelineItems.map((item, index) => (
                <div key={item.time} style={{ position: "relative", display: "flex", minHeight: index === timelineItems.length - 1 ? "70px" : "112px" }}>
                  <div style={{ display: "flex", width: "76px", paddingTop: "3px", fontSize: "18px", fontWeight: 700 }}>{item.time}</div>
                  <div style={{ position: "relative", display: "flex", width: "34px", justifyContent: "center" }}>
                    {index < timelineItems.length - 1 && (
                      <div style={{ position: "absolute", top: "17px", bottom: "-8px", width: "2px", display: "flex", background: "#d7d8cf" }} />
                    )}
                    <div style={{ width: "14px", height: "14px", marginTop: "7px", display: "flex", border: "3px solid #f3f0e9", borderRadius: "50%", background: item.color, boxShadow: `0 0 0 2px ${item.color}` }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", paddingLeft: "12px" }}>
                    <div style={{ display: "flex", color: item.color, fontSize: "14px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Điểm đến</div>
                    <div style={{ display: "flex", marginTop: "6px", fontSize: "25px", fontWeight: 700 }}>{item.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    socialPreviewSize,
  );
}
